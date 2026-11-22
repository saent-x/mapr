"""In-memory GeoNames gazetteer: normalised name -> candidate places.

File format (gzip TSV, written by build.py), one place per line:
  kind  cc  admin1  lat  lon  population  capital  name  key|key|...
kind is one of country, admin1, city, region, water. cc is ISO 3166-1 alpha-2 ("" for seas).
"""

from __future__ import annotations

import gzip
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

KINDS = ("country", "admin1", "city", "region", "water")


@dataclass(frozen=True, slots=True)
class Place:
    kind: str
    cc: str
    admin1: str
    lat: float
    lon: float
    population: int
    capital: bool
    name: str


@dataclass
class Gazetteer:
    places: list[Place] = field(default_factory=list)
    index: dict[str, list[int]] = field(default_factory=dict)
    countries: dict[str, Place] = field(default_factory=dict)

    def add(self, p: Place, keys: Iterable[str]) -> None:
        i = len(self.places)
        self.places.append(p)
        for k in dict.fromkeys(keys):
            if k:
                self.index.setdefault(k, []).append(i)
        if (
            p.kind == "country"
            and p.cc
            and (p.cc not in self.countries or p.population > self.countries[p.cc].population)
        ):
            self.countries[p.cc] = p

    def lookup(self, key: str) -> list[Place]:
        return [self.places[i] for i in self.index.get(key, ())]

    def country(self, cc: str) -> Place | None:
        return self.countries.get(cc)

    def __len__(self) -> int:
        return len(self.places)

    @classmethod
    def load(cls, path: str | Path) -> Gazetteer:
        g = cls()
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) != 9 or parts[0] not in KINDS:
                    continue
                kind, cc, admin1, lat, lon, pop, cap, name, keys = parts
                g.add(Place(kind, cc, admin1, float(lat), float(lon), int(pop), cap == "1", name), keys.split("|"))
        return g


def write(path: str | Path, rows: Iterable[tuple[Place, Iterable[str]]]) -> int:
    n = 0
    with gzip.open(path, "wt", encoding="utf-8") as f:
        for p, keys in rows:
            ks = "|".join(k for k in dict.fromkeys(keys) if k and "|" not in k and "\t" not in k)
            f.write(
                f"{p.kind}\t{p.cc}\t{p.admin1}\t{p.lat:.5f}\t{p.lon:.5f}\t{p.population}\t{int(p.capital)}\t{p.name}\t{ks}\n"
            )
            n += 1
    return n
