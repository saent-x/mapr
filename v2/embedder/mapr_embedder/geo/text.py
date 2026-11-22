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


def is_cjk(s: str) -> bool:
    """Han, kana or hangul: scripts where a two-character name is normal (台北, 日本, 서울)."""
    return any(
        "\u3040" <= c <= "\u30ff" or "\u3400" <= c <= "\u9fff" or "\uac00" <= c <= "\ud7af" or "\uf900" <= c <= "\ufaff"
        for c in s
    )


def min_key_len(key: str) -> int:
    return 2 if is_cjk(key) else 3


def cjk_forms(key: str) -> list[str]:
    """Other spellings of a CJK name: without 市/省/县/縣, and with 台/臺 swapped (台北市 -> 台北, 臺北, 臺北市)."""
    if not is_cjk(key):
        return []
    base = [key]
    for suf in _CJK_SUFFIXES:
        if key.endswith(suf) and len(key) > 2:
            base.append(key[:-1])
            break
    out = base + [b.translate(_TAI) for b in base if "台" in b or "臺" in b]
    return [k for k in dict.fromkeys(out) if k != key]


_AR_CLITICS = ("وال", "بال", "لل", "فال", "كال")  # and/with/for/so/like + the


def variants(key: str) -> list[str]:
    """The key itself, then looser forms tried only when it has no match ("eastern ukraine" -> "ukraine")."""
    out = [key, *cjk_forms(key)]
    k = key
    # Arabic attaches "and", "with", "for" to the article: والبيت الابيض -> البيت الابيض.
    for c in _AR_CLITICS:
        if k.startswith(c) and len(k) > len(c) + 2:
            k = "ال" + k[len(c) :]
            out.append(k)
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
