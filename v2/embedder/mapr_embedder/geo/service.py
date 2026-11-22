"""Geocode events: NER over every text of an event, then one location per event."""

from __future__ import annotations

from dataclasses import asdict
from typing import Protocol

from .gazetteer import Gazetteer
from .resolve import Entity, GeoResult, landmark_mentions, mentions_for, resolve


class NerLike(Protocol):
    model_id: str

    def extract(self, texts: list[str], batch_size: int = ...) -> list[list[Entity]]: ...


class GeoService:
    def __init__(self, ner: NerLike, gaz: Gazetteer) -> None:
        self.ner = ner
        self.gaz = gaz

    def geocode(self, events: list[tuple[list[tuple[str, float]], list[str]]]) -> list[dict]:
        """events: [(texts as (text, weight), source country codes)] -> one result dict per event."""
        flat = [t for texts, _ in events for t, _w in texts]
        ents = self.ner.extract(flat)
        out, i = [], 0
        for texts, sources in events:
            pairs = [(e, w) for (_, w), found in zip(texts, ents[i : i + len(texts)], strict=True) for e in found]
            i += len(texts)
            ner_mentions = mentions_for(self.gaz, pairs)
            # Text-searched landmarks only where NER did not already find that landmark.
            found = {m.key for m in ner_mentions}
            extra = [m for m in landmark_mentions(self.gaz, texts) if m.key not in found]
            r: GeoResult = resolve(self.gaz, ner_mentions + extra, sources)
            out.append(asdict(r))
        return out
