"""Pick one location for an event from the place names found in its texts.

Each mention (a LOC entity, or a demonym tagged MISC) gets its best gazetteer candidate. Candidates
score on what they are (a country beats a same-named town; big cities beat small ones) plus
context: a candidate whose country is named elsewhere in the event, or is the reporting outlet's
country, wins ties ("Georgia" next to "Atlanta" is the US state). Countries then vote with the
weights of the texts they appear in, and the event is placed at the most specific mention
inside the winning country.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

from .demonyms import ALIAS_KEYS, DEMONYMS
from .gazetteer import Gazetteer, Place
from .landmarks import LANDMARKS
from .text import is_cjk as _cjk
from .text import normalize, variants

SPECIFICITY = {"city": 3, "admin1": 2, "region": 2, "water": 1, "country": 1}
CONTEXT_BONUS = 2.0
NAME_BONUS = 1.0  # the mention is the place's own name, not one of its alternate names
SOURCE_BONUS = 0.3
MIN_SCORE = 0.5  # NER confidence below this is mostly noise on headlines


@dataclass(frozen=True)
class Entity:
    text: str
    label: str  # LOC, MISC, ...
    score: float


@dataclass(frozen=True)
class Mention:
    key: str
    weight: float
    candidates: tuple[Place, ...]


@dataclass(frozen=True)
class GeoResult:
    place: str | None
    country: str | None
    lat: float | None
    lon: float | None
    precision: str | None  # city | admin1 | region | water | country | source
    confidence: float

    @classmethod
    def none(cls) -> GeoResult:
        return cls(None, None, None, None, None, 0.0)


def base_score(p: Place) -> float:
    if p.kind == "country":
        return 3.0
    if p.kind == "admin1":
        return 1.2
    if p.kind in ("region", "water"):
        return 1.0
    return 0.4 + 0.25 * math.log10(p.population + 1) + (0.5 if p.capital else 0.0)


def mentions_for(gaz: Gazetteer, entities: list[tuple[Entity, float]]) -> list[Mention]:
    out = []
    for e, weight in entities:
        if e.score < MIN_SCORE:
            continue
        key = normalize(e.text)
        if not key:
            continue
        cands: list[Place] = []
        if e.label in ("LOC", "ORG", "MISC"):
            lm = next((k for k in variants(key) if k in LANDMARKS), None)
            if lm:
                cands = landmark(gaz, lm)
        if not cands and e.label == "LOC":
            for k in variants(key):
                cands = gaz.lookup(k)
                if not cands and k in ALIAS_KEYS and (c := gaz.country(ALIAS_KEYS[k])):
                    cands = [c]
                if cands:
                    break
        if not cands and key in DEMONYMS and (c := gaz.country(DEMONYMS[key])):
            cands = [c]
        if cands:
            out.append(Mention(key, weight * e.score, tuple(cands)))
    return out


def landmark_mentions(gaz: Gazetteer, texts: list[tuple[str, float]]) -> list[Mention]:
    """Landmarks found by plain text search, so they count even when NER misses or splits them."""
    out = []
    for text, weight in texts:
        hay = f" {normalize(text)} "
        for key in LANDMARKS:
            hit = key in hay if _cjk(key) else f" {key} " in hay
            if hit and (cands := landmark(gaz, key)):
                out.append(Mention(key, weight, tuple(cands)))
    return out


def landmark(gaz: Gazetteer, key: str) -> list[Place]:
    cc, city = LANDMARKS[key]
    found = [p for p in gaz.lookup(normalize(city)) if p.cc == cc and p.kind == "city"] if city else []
    if city and not found:  # the gazetteer spells it differently ("Washington, D.C."): the capital is meant
        found = [p for p in gaz.places if p.cc == cc and p.capital]
    if found:
        return [max(found, key=lambda p: p.population)]
    c = gaz.country(cc)
    return [c] if c else []


def _pick(m: Mention, context: set[str], sources: set[str]) -> Place:
    def score(p: Place) -> float:
        s = base_score(p)
        if normalize(p.name) == m.key:
            s += NAME_BONUS
        if p.cc and p.cc in context:
            s += CONTEXT_BONUS
        if p.cc and p.cc in sources:
            s += SOURCE_BONUS
        return s

    return max(m.candidates, key=score)


def resolve(gaz: Gazetteer, mentions: list[Mention], source_countries: list[str]) -> GeoResult:
    sources = {c for c in source_countries if c}
    if not mentions:
        # Nothing named: an outlet that only covers one country is still a usable clue.
        if len(sources) == 1 and (c := gaz.country(next(iter(sources)))):
            return GeoResult(None, c.cc, c.lat, c.lon, "source", 0.3)
        return GeoResult.none()

    # Countries the event names outright (and unambiguous mentions), used as context for the rest.
    named: dict[str, set[str]] = defaultdict(set)
    for m in mentions:
        ccs = {p.cc for p in m.candidates if p.cc}
        for p in m.candidates:
            if p.kind == "country" or len(ccs) == 1:
                named[m.key].add(p.cc)

    chosen: list[tuple[Mention, Place]] = []
    for m in mentions:
        context = {cc for k, ccs in named.items() if k != m.key for cc in ccs}
        chosen.append((m, _pick(m, context, sources)))

    votes: dict[str, float] = defaultdict(float)
    for m, p in chosen:
        if p.cc:
            votes[p.cc] += m.weight
    total = sum(m.weight for m, _ in chosen)
    if votes:
        cc = max(votes, key=lambda c: (votes[c], c in sources))
        conf = votes[cc] / total
        inside = [(m, p) for m, p in chosen if p.cc == cc]
    else:  # only seas and straits
        cc, conf, inside = None, 1.0, chosen

    weight_of: dict[int, float] = defaultdict(float)
    by_id: dict[int, Place] = {}
    for m, p in inside:
        weight_of[id(p)] += m.weight
        by_id[id(p)] = p
    best = by_id[max(by_id, key=lambda i: (SPECIFICITY[by_id[i].kind], weight_of[i], by_id[i].population))]
    country = gaz.country(cc) if cc else None
    if best.kind == "country" and country:
        best = country
    return GeoResult(best.name, cc, best.lat, best.lon, best.kind, round(conf, 3))
