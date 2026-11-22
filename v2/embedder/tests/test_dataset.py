import json
from collections import Counter
from pathlib import Path

import pytest

from bakeoff import build_dataset as B

HERE = Path(__file__).resolve().parents[1] / "bakeoff"


def art(i, title, summary="", ts="2026-03-19T10:00:00Z", lang="en", source="src"):
    return {"id": i, "title": title, "summary": summary, "publishedAt": ts, "language": lang, "source": source}


def ev(eid, *arts):
    return {"id": eid, "supportingArticles": list(arts)}


def test_clean_text_strips_html_and_junk():
    assert B.clean_text("<p>Hello &amp; <b>world</b></p>") == "Hello & world"
    assert B.clean_text("Title event.key === 'Enter' ? window.location = x") == "Title"
    assert B.clean_text("Body text. The post Foo appeared first on Bar.") == "Body text."


def test_make_lead_drops_title_echo_and_short_leads():
    assert B.make_lead("Some headline here", "Some headline here") == ""
    assert B.make_lead("Headline", "Too short") == ""
    lead = B.make_lead("Headline", "Headline: and then a long enough description follows")
    assert lead.startswith("and then")
    assert len(B.make_lead("H", "word " * 400)) <= B.LEAD_MAX_CHARS


def test_detect_lang():
    assert B.detect_lang("English", "anything") == ("en", "feed")
    assert B.detect_lang("en", "ក្រសួងទេសចរណ៍ និងធនាគារ") == ("km", "script")  # feed label wrong
    assert B.detect_lang("uk", "Зеленський заявив") == ("uk", "feed")  # script family agrees
    assert B.detect_lang("unknown", "The minister said on Monday that the plan is for the city") == ("en", "stopwords")
    assert B.detect_lang("unknown", "Xyz qwv") == ("und", "unknown")


def test_classify_event():
    r = lambda t, ts: {"title": t, "published_at": ts}  # noqa: E731
    assert B.classify_event("evt-b02upfmybp2b", [r("a", None), r("b", None)]).startswith("manual")
    assert B.classify_event("x", [r("Swedish word of the day: x", None), r("y", None)]) == "series template title"
    assert "spans" in B.classify_event("x", [r("a", "2026-03-01T00:00:00Z"), r("b", "2026-03-05T00:00:00Z")])
    assert B.classify_event("x", [r("a", "2026-03-01T00:00:00Z"), r("b", "2026-03-02T00:00:00Z")]) is None


def synthetic():
    events = [
        ev(
            "e-multi",
            art("a1", "Quake hits city of Foo", "Rescuers search rubble after a strong quake struck Foo."),
            art(
                "a2",
                "Foo earthquake toll rises",
                "Officials say the toll from the Foo quake has risen sharply.",
                ts="2026-03-19T20:00:00Z",
            ),
        ),
        ev(
            "e-series",
            art("s1", "Today in Spain: A roundup of the latest news on Monday"),
            art("s2", "Today in Spain: A roundup of the latest news on Tuesday"),
        ),
        ev("e-single1", art("b1", "Parliament passes the new budget bill")),
        ev("e-single2", art("b2", "Parliament passes the new budget bill", source="other")),  # exact dup -> merged
        ev("e-single3", art("c1", "Football club wins the national cup final")),
        ev("e-single4", art("d1", "Ministry announces new rail line to the coast")),
    ]
    extra = [
        art("x1", "Le gouvernement annonce une nouvelle loi sur l'eau", lang="fr"),
        art("x2", "Earthquake in Foo leaves thousands homeless", lang="en"),  # English unlabelled: skipped
        art("x3", "Sismo en Foo deja miles de damnificados", lang="es"),
    ]
    curated = [{"group": "cur-001", "members": [{"id": "a1"}, {"id": "x3"}]}]
    return events, extra, curated


def test_build_end_to_end():
    events, extra, curated = synthetic()
    rows, queries, stats = B.build(events, extra, curated=curated, target_total=100, seed=1)
    by_id = {r["id"]: r for r in rows}
    # curated member a1 pulls its whole clean legacy event (a2) and the Spanish distractor x3
    assert {r["id"] for r in rows if r["event_id"] == "cur-001"} == {"a1", "a2", "x3"}
    assert by_id["x3"]["label_source"] == "curated"
    # series event dropped as a positive, recorded with a reason
    assert "e-series" in stats["excluded_positive_events"] and "s1" not in by_id
    # exact-title duplicate singletons merged into one label
    assert by_id["b1"]["event_id"] == by_id["b2"]["event_id"]
    assert by_id["b1"]["dup_group"] and by_id["b1"]["dup_group"] == by_id["b2"]["dup_group"]
    # English unlabelled articles are not used as distractors, French ones are
    assert "x2" not in by_id and by_id["x1"]["label_source"] == "unlabelled_distractor"
    sizes = Counter(r["event_id"] for r in rows)
    assert all(r["event_size"] == sizes[r["event_id"]] for r in rows)
    # queries: never relevant to themselves; exact duplicates are excluded, not relevant
    for q in queries:
        assert q["query_article_id"] in q["exclude_ids"]
        assert not set(q["relevant_ids"]) & set(q["exclude_ids"])
    dup_q = [q for q in queries if q["query_article_id"] in ("b1", "b2")]
    assert dup_q == []  # b1/b2 are only each other's exact duplicates -> nothing left to retrieve
    assert stats["positive_events"] == 2


def test_build_is_deterministic():
    a = B.build(*synthetic()[:2], curated=synthetic()[2], target_total=100, seed=5)
    b = B.build(*synthetic()[:2], curated=synthetic()[2], target_total=100, seed=5)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_unknown_curated_member_raises():
    events, extra, _ = synthetic()
    with pytest.raises(KeyError):
        B.build(events, extra, curated=[{"group": "cur-x", "members": [{"id": "nope"}]}])


@pytest.mark.skipif(not (HERE / "dataset.jsonl").exists(), reason="dataset not built")
def test_committed_dataset_invariants():
    rows = [json.loads(line) for line in (HERE / "dataset.jsonl").read_text(encoding="utf-8").splitlines()]
    queries = [json.loads(line) for line in (HERE / "queries.jsonl").read_text(encoding="utf-8").splitlines()]
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids))
    assert 500 <= len(rows) <= 1500
    sizes = Counter(r["event_id"] for r in rows)
    assert all(r["event_size"] == sizes[r["event_id"]] for r in rows)
    assert all(r["text"].strip() and r["published_at"] for r in rows)
    idset = set(ids)
    for q in queries:
        assert set(q["relevant_ids"]) <= idset and q["query_article_id"] in idset
        assert {sizes[r] for r in q["relevant_ids"]} == {sizes[q["query_article_id"]]}
