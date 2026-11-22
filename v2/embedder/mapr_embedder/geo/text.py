"""Name normalisation shared by the gazetteer build and lookups, so both sides agree on keys."""

from __future__ import annotations

import re
import unicodedata

_POSSESSIVE = re.compile(r"['’`´]s\b", re.IGNORECASE)
_APOSTROPHE = re.compile(r"['’`´ʼ]")
_NON_WORD = re.compile(r"[^\w]+", re.UNICODE)
_SPACES = re.compile(r"\s+")


def normalize(s: str) -> str:
    """Casefolded, accent-free, punctuation-free key: "Côte d'Ivoire" -> "cote divoire", "Ukraine's" -> "ukraine"."""
    s = unicodedata.normalize("NFKC", s)
    s = _POSSESSIVE.sub("", s)
    s = _APOSTROPHE.sub("", s).casefold()
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if unicodedata.category(c) != "Mn")
    s = _NON_WORD.sub(" ", s).replace("_", " ")
    return _SPACES.sub(" ", s).strip()


_LEADING = ("the ", "northern ", "southern ", "eastern ", "western ", "central ", "north ", "south ", "east ", "west ")
_TRAILING = (
    " region", " province", " oblast", " state", " city", " governorate", " district", " county", " prefecture",
    " territory", " area", " municipality", " department", " island", " islands",
)  # fmt: skip


_CJK_SUFFIXES = ("市", "省", "县", "縣")  # city, province, county: 台北市 -> 台北 (not 州: 广州 is a name)
_TAI = str.maketrans({"台": "臺", "臺": "台"})  # simplified and traditional forms of "Tai" both occur


def variants(key: str) -> list[str]:
    """The key itself, then looser forms tried only when it has no match ("eastern ukraine" -> "ukraine")."""
    out = [key]
    k = key
    if "台" in k or "臺" in k:
        out.append(k.translate(_TAI))
    for suf in _CJK_SUFFIXES:
        if k.endswith(suf) and len(k) > 1:
            out += [k[:-1], k[:-1].translate(_TAI)]
            break
    for p in _LEADING:
        if k.startswith(p) and len(k) > len(p) + 2:
            k = k[len(p) :]
            out.append(k)
            break
    for t in _TRAILING:
        if k.endswith(t) and len(k) > len(t) + 2:
            out.append(k[: -len(t)])
            break
    return list(dict.fromkeys(out))
