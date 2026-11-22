"""Build the gazetteer from the GeoNames dump (CC BY 4.0, https://www.geonames.org).

    python -m mapr_embedder.geo.build --dump allCountries.zip --country-info countryInfo.txt --out gazetteer.tsv.gz
    python -m mapr_embedder.geo.build --download /models/geonames --out /models/geonames/gazetteer.tsv.gz

--download fetches both files into that folder first and deletes the ~400 MB dump once the build is done.

Kept from the ~13M rows: countries and dependencies, first-level divisions, populated places with
5,000+ people or an admin seat, and notable regions, seas, straits, gulfs, peninsulas and islands
("notable" = named in at least three languages). Smaller places would mostly add false matches.
"""

from __future__ import annotations

import argparse
import io
import logging
import shutil
import urllib.request
import zipfile
from collections.abc import Iterator
from pathlib import Path

from .demonyms import ALIASES
from .gazetteer import Place, write
from .text import normalize

log = logging.getLogger(__name__)

GEONAMES_URL = "https://download.geonames.org/export/dump/"

COUNTRY_CODES = {"PCLI", "PCLD", "PCLF", "PCLS", "PCLIX", "PCL", "TERR"}
CITY_SEATS = {"PPLC", "PPLA", "PPLG"}
CITY_SKIP = {"PPLH", "PPLQ", "PPLW", "PPLCH", "PPLF", "PPLR"}
REGION_CODES = {("L", "RGN"), ("T", "PEN"), ("T", "ISL"), ("T", "ISLS")}
WATER_CODES = {"SEA", "OCN", "STRT", "GULF"}
MIN_CITY_POP = 5_000
ALT_CITY_POP = 50_000  # smaller towns are matched by their own name only, not every alternate spelling
NOTABLE_ALT_NAMES = 3

# One-word keys that are ordinary words in some language and would match too often.
STOP_KEYS = {
    "of", "and", "the", "new", "city", "center", "centre", "bay", "lake", "port", "north", "south", "east", "west",
    "central", "union", "republic", "state", "states", "island", "islands", "kingdom", "capital", "university",
    "district", "region", "province", "county", "valley", "mount", "river", "sea", "gulf", "strait", "coast",
    "police", "army", "news", "world", "president", "government", "minister", "court", "market", "europe",
}  # fmt: skip


def _ok_alt(raw: str) -> bool:
    if not raw or len(raw) > 60 or any(c.isdigit() for c in raw) or "http" in raw:
        return False
    # Codes (IATA, ISO, abbreviations) are not names: "KBL", "UKR".
    return not (raw.isascii() and raw.isupper() and len(raw) <= 4)


def keys_for(name: str, ascii_name: str, alts: list[str], with_alts: bool) -> list[str]:
    raws = [name, ascii_name, *(a for a in alts if with_alts and _ok_alt(a))]
    out = []
    for r in raws:
        k = normalize(r)
        if len(k) >= 3 and k not in STOP_KEYS:
            out.append(k)
    return list(dict.fromkeys(out))


def _lines(dump: Path) -> Iterator[str]:
    if dump.suffix == ".zip":
        with zipfile.ZipFile(dump) as z:
            member = next(n for n in z.namelist() if n.endswith(".txt") and not n.startswith("readme"))
            with z.open(member) as raw:
                yield from io.TextIOWrapper(raw, encoding="utf-8")
    else:
        with dump.open(encoding="utf-8") as f:
            yield from f


def country_names(path: Path | None) -> dict[str, str]:
    """ISO alpha-2 -> English short name from countryInfo.txt (GeoNames' own country names)."""
    if not path:
        return {}
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("#") or not line.strip():
            continue
        cols = line.split("\t")
        if len(cols) > 4 and len(cols[0]) == 2:
            out[cols[0]] = cols[4]
    return out


def classify(fclass: str, fcode: str, pop: int, n_alts: int) -> str | None:
    if fclass == "A" and fcode in COUNTRY_CODES:
        return "country"
    if fclass == "A" and fcode == "ADM1":
        return "admin1"
    if fclass == "P" and fcode not in CITY_SKIP:
        if fcode in CITY_SEATS or pop >= MIN_CITY_POP:
            return "city"
        return None
    if (fclass, fcode) in REGION_CODES and n_alts >= NOTABLE_ALT_NAMES:
        return "region"
    if fclass == "H" and fcode in WATER_CODES and n_alts >= NOTABLE_ALT_NAMES:
        return "water"
    return None


def parse(lines: Iterator[str], names: dict[str, str]) -> Iterator[tuple[Place, list[str]]]:
    for line in lines:
        c = line.rstrip("\n").split("\t")
        if len(c) < 15:
            continue
        fclass, fcode, cc = c[6], c[7], c[8]
        try:
            pop = int(c[14] or 0)
        except ValueError:
            pop = 0
        alts = [a for a in c[3].split(",") if a]
        kind = classify(fclass, fcode, pop, len(alts))
        if not kind:
            continue
        name = c[1]
        if kind == "country" and fcode == "PCLI" and cc in names:
            name = names[cc]
        with_alts = kind != "city" or pop >= ALT_CITY_POP or fcode in CITY_SEATS
        keys = keys_for(name, c[2], alts, with_alts)
        if kind == "country":
            keys += [normalize(a) for a, code in ALIASES.items() if code == cc]
        if not keys:
            continue
        yield (
            Place(kind, "" if kind == "water" else cc, c[10], float(c[4]), float(c[5]), pop, fcode == "PPLC", name),
            keys,
        )


def fetch(name: str, folder: Path) -> Path:
    dest = folder / name
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    tmp = dest.with_suffix(dest.suffix + ".part")
    log.info("downloading %s%s", GEONAMES_URL, name)
    req = urllib.request.Request(GEONAMES_URL + name, headers={"User-Agent": "mapr-gazetteer-build"})
    with urllib.request.urlopen(req, timeout=120) as r, tmp.open("wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    tmp.replace(dest)
    return dest


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--dump", type=Path, help="allCountries.zip (or .txt) from download.geonames.org")
    src.add_argument("--download", type=Path, metavar="DIR", help="fetch allCountries.zip and countryInfo.txt here")
    ap.add_argument("--country-info", type=Path, help="countryInfo.txt, for English country names")
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args(argv)
    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(message)s")
    dump, info = a.dump, a.country_info
    if a.download:
        a.download.mkdir(parents=True, exist_ok=True)
        info = fetch("countryInfo.txt", a.download)
        dump = fetch("allCountries.zip", a.download)
    tmp = a.out.with_suffix(a.out.suffix + ".tmp")
    n = write(tmp, parse(_lines(dump), country_names(info)))
    if n < 10_000:  # a truncated download must not replace a good gazetteer
        tmp.unlink()
        raise SystemExit(f"only {n} places parsed from {dump}; gazetteer not replaced")
    tmp.replace(a.out)
    log.info("wrote %d places to %s", n, a.out)
    if a.download:
        dump.unlink()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
