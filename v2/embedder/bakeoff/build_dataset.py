"""Build the labelled bake-off dataset from the legacy MAPR SQLite file (opened read-only).

Where the labels come from: the legacy `events` / `event_articles` tables are empty in
data/mapr.db. The only event labels are in `metadata['snapshot']` (the last published
snapshot: 1493 events, each with its `supportingArticles`). Those groupings came from
the legacy title-similarity correlator, so they are silver labels, not gold:

* positives  = snapshot events with >= 2 articles, minus events a spot-check found to be
  topical/series groupings rather than one news event (see EXCLUDE_EVENTS / SERIES_RE),
  minus events spanning > MAX_EVENT_SPAN_H hours;
* singletons = snapshot events with 1 article, used as negatives / distractors. The
  legacy correlator under-merged, so some singleton pairs really are the same story;
  bake-off pair metrics are therefore "anchored" on positive-event articles only;
* exact-title duplicates across events are merged into one label (syndicated copies
  the legacy correlator missed);
* unlabelled non-English articles from the `articles` table (not in the snapshot) are
  added as distractors so the multilingual models face non-English negatives.

Usage:  python -m bakeoff.build_dataset --db /path/to/mapr.db --out-dir bakeoff
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import random
import re
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

SEED = 13
MAX_EVENT_SPAN_H = 72.0
LEAD_MAX_CHARS = 700
MIN_LEAD_CHARS = 25
MAX_QUERIES_PER_EVENT = 3

# Recurring columns / templates: same headline shape every day, different content.
SERIES_RE = re.compile(
    r"(word of the day|^today in [a-z ]+:|roundup of the latest news|intelligence brief|weather forecast"
    r"|fantasy football|tips, races, odds|^reader question|^the best |crossword|horoscope|^podcast\b"
    r"|^live:|minuto a minuto|live text)",
    re.I,
)

# Spot-check of every multi-article snapshot event (Oct 2026). Reason = why it is not one event.
EXCLUDE_EVENTS: dict[str, str] = {
    "evt-sq2o9f1agf3dz": "topic not event: three Diplomat op-eds + DW tourism piece on the Iran war",
    "evt-ayxl7bbe0pu3": "topic not event: two different Diplomat op-eds",
    "evt-1753yc43yt0zg": "topic not event: US intel testimony vs China-interests op-ed",
    "evt-4lfifp1v0xd69": "series: Europe vs Africa daily briefs",
    "evt-qx0k3n1oimf87": "different stories: 70 new hotels vs a shoe factory",
    "evt-b02upfmybp2b": "series: word of the day (2019 and 2024)",
    "evt-1xvizneqz0dlm": "series: reader questions (2022 and 2025)",
    "evt-1mve6oowbg6iw": "series: Cheltenham day 2/3/4 previews",
    "evt-yyepn01uwrmt0": "series: fantasy football weeks 28/29",
    "evt-ixt5q3va56eb": "different stories: sofa beds vs air beds reviews",
    "evt-1x03z616xch82": "series: daily weather forecast",
    "evt-6qtum21betnra": "series: daily news roundup",
    "evt-1v7vj9r1121fs7": "series: daily news roundup",
    "evt-8tai2h1udpge9": "series: daily news roundup",
    "evt-3ef053uoyylv": "different stories: NBC investment talks vs tourism debit card launch",
    "evt-1szsnd33itntv": "different stories: Tinubu vs Obi Eid messages",
    "evt-3zic4kyxfjh4": "different stories: royal pardon vs Eid prayer venue",
    "evt-1sadmee1ocjynm": "different stories: FlyArystan vs Cathay Pacific suspensions",
}

LANG_NAMES = {
    "english": "en",
    "spanish": "es",
    "french": "fr",
    "german": "de",
    "portuguese": "pt",
    "chinese": "zh",
    "hindi": "hi",
    "vietnamese": "vi",
    "ukrainian": "uk",
    "nepali": "ne",
    "arabic": "ar",
    "serbian": "sr",
    "turkish": "tr",
    "italian": "it",
    "romanian": "ro",
    "russian": "ru",
    "bengali": "bn",
    "greek": "el",
    "indonesian": "id",
    "bulgarian": "bg",
    "albanian": "sq",
    "polish": "pl",
    "hebrew": "he",
    "danish": "da",
    "norwegian": "no",
    "dutch": "nl",
    "latvian": "lv",
    "khmer": "km",
    "japanese": "ja",
    "korean": "ko",
    "thai": "th",
}
# Unicode script -> (default language, languages written in that script)
SCRIPTS = {
    "CYRILLIC": ("ru", {"ru", "uk", "sr", "bg", "mk", "ky", "kk", "be"}),
    "ARABIC": ("ar", {"ar", "fa", "ur", "ps"}),
    "CJK": ("zh", {"zh", "ja"}),
    "HIRAGANA": ("ja", {"ja"}),
    "KATAKANA": ("ja", {"ja"}),
    "HANGUL": ("ko", {"ko"}),
    "KHMER": ("km", {"km"}),
    "DEVANAGARI": ("hi", {"hi", "ne", "mr"}),
    "BENGALI": ("bn", {"bn"}),
    "HEBREW": ("he", {"he"}),
    "GREEK": ("el", {"el"}),
    "THAI": ("th", {"th"}),
}
EN_STOP = frozenset(
    "the of and to in a is for on with as by at from after over says said will has have are was its".split()  # noqa: SIM905
)

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_JUNK_RE = [
    re.compile(r"\s*event\.key\s*===.*$", re.S),  # tvnet.lv scraped onclick handler
    re.compile(r"\s*The post .{0,300} appeared first on .*$", re.S),  # WordPress RSS footer
    re.compile(r"\s*Continue reading\.*\s*$", re.I),
    re.compile(r"^News24\s*\|\s*"),
    re.compile(r"^(?::\s*)?(?:Vidéo|Reportage)\s*:\s*(?:(?:Vidéo|Reportage)\s*)?"),
]


def clean_text(s: str | None) -> str:
    if not s:
        return ""
    s = html.unescape(html.unescape(s))
    s = _TAG_RE.sub(" ", s)
    for rx in _JUNK_RE:
        s = rx.sub("", s)
    s = s.replace("​", "").replace(" ", " ")
    return _WS_RE.sub(" ", s).strip()


def norm_key(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).casefold()
    return re.sub(r"[\W_]+", "", s)


def make_lead(title: str, summary: str) -> str:
    lead = clean_text(summary)
    t, lk = norm_key(title), norm_key(lead)
    if not lk or lk == t or t.startswith(lk):
        return ""
    if lk.startswith(t) and lead[: len(title)].casefold() == title.casefold():
        lead = lead[len(title) :].lstrip(" :-|–—.")
    if len(lead) < MIN_LEAD_CHARS:
        return ""
    if len(lead) > LEAD_MAX_CHARS:
        cut = lead[:LEAD_MAX_CHARS]
        lead = cut[: cut.rfind(" ")] if " " in cut else cut
    return lead


def dominant_script(text: str) -> str | None:
    """Non-Latin script making up >= 30% of letters, else None."""
    counts: Counter[str] = Counter()
    letters = 0
    for ch in text:
        if not ch.isalpha():
            continue
        letters += 1
        name = unicodedata.name(ch, "")
        for key in SCRIPTS:
            if name.startswith(key):
                counts[key] += 1
                break
    if not letters or not counts:
        return None
    key, n = counts.most_common(1)[0]
    return key if n / letters >= 0.3 else None


def detect_lang(feed_lang: str | None, text: str) -> tuple[str, str]:
    """(language code, how it was decided). Feed labels are wrong surprisingly often."""
    raw = (feed_lang or "").strip().lower()
    feed = LANG_NAMES.get(raw, raw if 2 <= len(raw) <= 3 and raw != "unk" else "")
    script = dominant_script(text)
    if script:
        default, family = SCRIPTS[script]
        if feed in family:
            return feed, "feed"
        return default, "script"
    if feed and feed != "unknown":
        return feed, "feed"
    words = re.findall(r"[a-z']+", text.lower())
    if words and sum(w in EN_STOP for w in words) >= max(2, 0.08 * len(words)):
        return "en", "stopwords"
    return "und", "unknown"


def parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def to_row(a: dict, event_id: str, label_source: str) -> dict:
    title = clean_text(a.get("title"))
    lead = make_lead(title, a.get("summary") or "")
    text = f"{title}\n{lead}" if lead else title
    lang, lang_source = detect_lang(a.get("language"), text)
    ts = parse_ts(a.get("publishedAt"))
    return {
        "id": a["id"],
        "title": title,
        "lead": lead,
        "text": text,
        "event_id": event_id,
        "lang": lang,
        "lang_source": lang_source,
        "published_at": ts.isoformat().replace("+00:00", "Z") if ts else None,
        "source": a.get("source"),
        "label_source": label_source,
    }


def classify_event(event_id: str, rows: list[dict]) -> str | None:
    """Reason to drop a multi-article event as a positive, or None if it looks like one event."""
    if event_id in EXCLUDE_EVENTS:
        return "manual: " + EXCLUDE_EVENTS[event_id]
    if any(SERIES_RE.search(r["title"]) for r in rows):
        return "series template title"
    times = [parse_ts(r["published_at"]) for r in rows]
    times = [t for t in times if t]
    if len(times) >= 2:
        span_h = (max(times) - min(times)).total_seconds() / 3600
        if span_h > MAX_EVENT_SPAN_H:
            return f"spans {span_h:.0f}h > {MAX_EVENT_SPAN_H:.0f}h"
    return None


def apply_curated(
    rows_by_event: dict[str, list[dict]],
    extra_rows: dict[str, dict],
    curated: list[dict],
) -> tuple[dict[str, list[dict]], int]:
    """Move hand-reviewed groups into their own labels.

    A member that belongs to a clean multi-article legacy event pulls that whole event
    in (so a legacy positive is never split); members of noisy legacy events move alone.
    Groups that end up sharing a legacy event are merged.
    """
    loc: dict[str, str] = {r["id"]: eid for eid, rs in rows_by_event.items() for r in rs}
    parent = {g["group"]: g["group"] for g in curated}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    claimed_event: dict[str, str] = {}
    members: dict[str, list[str]] = {}
    for g in curated:
        gid = g["group"]
        ids = []
        for m in g["members"]:
            aid = m["id"]
            if aid in loc:
                eid = loc[aid]
                legacy = rows_by_event[eid]
                if len(legacy) >= 2 and classify_event(eid, legacy) is None:
                    if eid in claimed_event:
                        parent[find(gid)] = find(claimed_event[eid])
                    claimed_event[eid] = gid
                    ids += [r["id"] for r in legacy]
                    continue
            ids.append(aid)
        members[gid] = ids

    merged: dict[str, list[str]] = defaultdict(list)
    for gid, ids in members.items():
        merged[find(gid)] += ids
    moved = 0
    out = {k: list(v) for k, v in rows_by_event.items()}
    for gid, ids in sorted(merged.items()):
        group_rows, seen = [], set()
        for aid in ids:
            if aid in seen:
                continue
            seen.add(aid)
            if aid in loc:
                eid = loc[aid]
                row = next(r for r in out[eid] if r["id"] == aid)
                out[eid] = [r for r in out[eid] if r["id"] != aid]
            elif aid in extra_rows:
                row = extra_rows.pop(aid)
            else:
                raise KeyError(f"curated member {aid} ({gid}) not found in the DB")
            row["event_id"], row["label_source"] = gid, "curated"
            group_rows.append(row)
            moved += 1
        out[gid] = group_rows
    return {k: v for k, v in out.items() if v}, moved


def build(
    events: list[dict],
    extra_articles: list[dict],
    *,
    curated: list[dict] | None = None,
    target_total: int = 1000,
    max_distractors: int = 350,
    seed: int = SEED,
) -> tuple[list[dict], list[dict], dict]:
    """Pure function: snapshot events + unlabelled articles (+ curated groups) -> (rows, queries, stats)."""
    rng = random.Random(seed)
    rows_by_event: dict[str, list[dict]] = {}
    for ev in sorted(events, key=lambda e: e["id"]):
        arts = ev.get("supportingArticles") or []
        rows_by_event[ev["id"]] = [
            to_row(a, ev["id"], "legacy_event" if len(arts) >= 2 else "legacy_singleton") for a in arts
        ]
    extra_rows = {a["id"]: to_row(a, "unl-" + a["id"], "unlabelled_distractor") for a in extra_articles}

    curated_moved = 0
    if curated:
        rows_by_event, curated_moved = apply_curated(rows_by_event, extra_rows, curated)
    curated_ids = {g["group"] for g in curated or []}

    # Merge exact-title duplicates across events (legacy correlator missed them).
    # Multi-article events absorb singletons; between singletons the first id wins.
    owner: dict[str, str] = {}
    merges = 0
    order = sorted(rows_by_event, key=lambda e: (e not in curated_ids, -len(rows_by_event[e]), e))
    for eid in order:
        for r in list(rows_by_event[eid]):
            k = norm_key(r["title"])
            if len(k) < 12:
                continue
            if k in owner and owner[k] != eid and len(rows_by_event[eid]) == 1:
                target = owner[k]
                r["event_id"], r["label_source"] = target, "merged_exact_title"
                rows_by_event[target].append(r)
                rows_by_event[eid] = []
                merges += 1
            else:
                owner.setdefault(k, eid)
    rows_by_event = {k: v for k, v in rows_by_event.items() if v}
    for rs in rows_by_event.values():
        if len(rs) >= 2:
            for r in rs:
                if r["label_source"] == "legacy_singleton":
                    r["label_source"] = "legacy_event"

    excluded: dict[str, str] = {}
    positives: dict[str, list[dict]] = {}
    singletons: list[dict] = []
    for eid, rs in rows_by_event.items():
        if eid in curated_ids:
            if len(rs) >= 2:
                positives[eid] = rs
            continue
        if len(rs) >= 2:
            reason = classify_event(eid, rs)
            if reason:
                excluded[eid] = reason
            else:
                positives[eid] = rs
        elif not SERIES_RE.search(rs[0]["title"]):
            singletons.append(rs[0])

    core = [r for rs in positives.values() for r in rs]
    taken_keys = {norm_key(r["title"]) for rs in rows_by_event.values() for r in rs}

    distractors = []
    for aid in sorted(extra_rows):
        r = extra_rows[aid]
        k = norm_key(r["title"])
        if r["lang"] in ("en", "und") or k in taken_keys or SERIES_RE.search(r["title"]) or len(k) < 12:
            continue
        taken_keys.add(k)
        distractors.append(r)
    rng.shuffle(distractors)
    distractors = distractors[:max_distractors]

    non_en = [r for r in singletons if r["lang"] != "en"]
    en = [r for r in singletons if r["lang"] == "en"]
    # Prefer English singletons that carry a lead (closer to what the v2 ingestor embeds).
    en_lead = [r for r in en if r["lead"]]
    en_nolead = [r for r in en if not r["lead"]]
    rng.shuffle(en_lead)
    rng.shuffle(en_nolead)
    room = max(0, target_total - len(core) - len(non_en) - len(distractors))
    picked_en = (en_lead + en_nolead)[:room]

    rows = core + non_en + picked_en + distractors
    rows.sort(key=lambda r: (r["published_at"] or "", r["id"]))

    # Exact-text duplicate groups (syndication): pairs inside a group are trivially similar.
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        groups[norm_key(r["text"])].append(r)
    for r in rows:
        g = groups[norm_key(r["text"])]
        r["dup_group"] = ("d" + hashlib.sha1(norm_key(r["text"]).encode()).hexdigest()[:10]) if len(g) > 1 else None

    sizes = Counter(r["event_id"] for r in rows)
    for r in rows:
        r["event_size"] = sizes[r["event_id"]]

    queries = build_queries(rows, rng)
    stats = dataset_stats(rows, queries, excluded, merges, positives)
    stats["curated_articles"] = curated_moved
    return rows, queries, stats


def build_queries(rows: list[dict], rng: random.Random) -> list[dict]:
    """Leave-one-out retrieval: an article's title is the query, the rest of its event is relevant.

    The query article and its exact-text duplicates are removed from the corpus for that
    query (run.py honours `exclude_ids`), so a model cannot win by matching itself.
    """
    by_event: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["event_size"] >= 2:
            by_event[r["event_id"]].append(r)
    queries = []
    for eid in sorted(by_event):
        members = sorted(by_event[eid], key=lambda r: r["id"])
        cands = []
        for q in members:
            same = [m["id"] for m in members if m is q or (q["dup_group"] and m["dup_group"] == q["dup_group"])]
            relevant = [m["id"] for m in members if m["id"] not in same]
            if relevant:
                cands.append((q, same, relevant))
        rng.shuffle(cands)
        for q, same, relevant in cands[:MAX_QUERIES_PER_EVENT]:
            queries.append(
                {
                    "query_id": f"q-{q['id']}",
                    "query": q["title"],
                    "query_article_id": q["id"],
                    "event_id": eid,
                    "lang": q["lang"],
                    "relevant_ids": relevant,
                    "exclude_ids": same,
                }
            )
    queries.sort(key=lambda q: q["query_id"])
    return queries


def dataset_stats(rows, queries, excluded, merges, positives) -> dict:
    multi = Counter(r["event_id"] for r in rows if r["event_size"] >= 2)
    pos_pairs = sum(n * (n - 1) // 2 for n in multi.values())
    trivial = 0
    for eid in multi:
        dg = Counter(r["dup_group"] for r in rows if r["event_id"] == eid and r["dup_group"])
        trivial += sum(n * (n - 1) // 2 for n in dg.values())
    times = sorted(r["published_at"] for r in rows if r["published_at"])
    return {
        "articles": len(rows),
        "events": len({r["event_id"] for r in rows}),
        "positive_events": len(multi),
        "positive_event_sizes": dict(sorted(Counter(multi.values()).items())),
        "articles_in_positive_events": sum(multi.values()),
        "positive_pairs": pos_pairs,
        "positive_pairs_exact_duplicate_text": trivial,
        "by_label_source": dict(Counter(r["label_source"] for r in rows).most_common()),
        "by_lang": dict(Counter(r["lang"] for r in rows).most_common()),
        "by_lang_in_positive_events": dict(Counter(r["lang"] for r in rows if r["event_size"] >= 2).most_common()),
        "lang_source": dict(Counter(r["lang_source"] for r in rows).most_common()),
        "with_lead": sum(1 for r in rows if r["lead"]),
        "published_range": [times[0], times[-1]] if times else None,
        "queries": len(queries),
        "merged_exact_title_duplicates": merges,
        "excluded_positive_events": excluded,
        "kept_positive_events": {eid: rs[0]["title"] for eid, rs in sorted(positives.items())},
    }


def load_db(db_path: str) -> tuple[list[dict], list[dict]]:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        n_events = con.execute("SELECT count(*) FROM events").fetchone()[0]
        n_links = con.execute("SELECT count(*) FROM event_articles").fetchone()[0]
        row = con.execute("SELECT value FROM metadata WHERE key = 'snapshot'").fetchone()
        if row is None:
            raise SystemExit("no metadata.snapshot in DB and no other source of event labels")
        snap = json.loads(row[0])
        events = snap["events"]
        in_snap = {a["id"] for e in events for a in e.get("supportingArticles") or []}
        extra = [json.loads(p) for (p,) in con.execute("SELECT payload FROM articles ORDER BY id")]
        extra = [a for a in extra if a["id"] not in in_snap]
    finally:
        con.close()
    if n_events or n_links:
        print(f"note: events={n_events} event_articles={n_links} present but labels are taken from the snapshot")
    return events, extra


def main(argv: list[str] | None = None) -> None:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=str(here.parents[2] / "data" / "mapr.db"))
    ap.add_argument("--out-dir", default=str(here))
    ap.add_argument("--target-total", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--curated", default=str(here / "curated_groups.json"), help="hand-reviewed groups ('' to skip)")
    args = ap.parse_args(argv)

    events, extra = load_db(args.db)
    curated = []
    if args.curated and Path(args.curated).exists():
        curated = json.loads(Path(args.curated).read_text(encoding="utf-8"))["groups"]
    rows, queries, stats = build(events, extra, curated=curated, target_total=args.target_total, seed=args.seed)
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "dataset.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    with open(out / "queries.jsonl", "w", encoding="utf-8") as f:
        for q in queries:
            f.write(json.dumps(q, ensure_ascii=False) + "\n")
    with open(out / "dataset_stats.json", "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)
    brief = {k: v for k, v in stats.items() if k not in ("excluded_positive_events", "kept_positive_events")}
    print(json.dumps(brief, ensure_ascii=False, indent=2))
    print(f"excluded positive events: {len(stats['excluded_positive_events'])}")


if __name__ == "__main__":
    main()
