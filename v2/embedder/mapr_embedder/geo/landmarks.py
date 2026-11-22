"""Names that NER tags as places but stand for a seat of power, not a spot on the map with that name.

"White House" is not Casablanca (Arabic البيت الأبيض, Spanish Casa Blanca), and "the Kremlin" has no
gazetteer entry. Each maps to (country, city) and resolves to that city.
"""

from __future__ import annotations

from .text import normalize

_LANDMARKS: dict[str, tuple[str, str | None]] = {
    # United States
    "White House": ("US", "Washington"), "Casa Blanca": ("US", "Washington"), "Maison Blanche": ("US", "Washington"),
    "Weißes Haus": ("US", "Washington"), "Casa Bianca": ("US", "Washington"), "Casa Branca": ("US", "Washington"),
    "Белый дом": ("US", "Washington"), "Білий дім": ("US", "Washington"), "Biały Dom": ("US", "Washington"),
    "البيت الأبيض": ("US", "Washington"), "白宫": ("US", "Washington"), "白宮": ("US", "Washington"),
    "ホワイトハウス": ("US", "Washington"), "Bela kuća": ("US", "Washington"), "Bijela kuća": ("US", "Washington"),
    "Bela hiša": ("US", "Washington"), "Shtëpia e Bardhë": ("US", "Washington"), "Capitol Hill": ("US", "Washington"),
    "Pentagon": ("US", "Washington"), "Pentágono": ("US", "Washington"), "Пентагон": ("US", "Washington"),
    "البنتاغون": ("US", "Washington"), "五角大楼": ("US", "Washington"), "五角大廈": ("US", "Washington"),
    "Wall Street": ("US", "New York"), "Silicon Valley": ("US", "San Jose"),
    # Russia
    "Kremlin": ("RU", "Moscow"), "Kreml": ("RU", "Moscow"), "Kremlin de Moscú": ("RU", "Moscow"),
    "Кремль": ("RU", "Moscow"), "الكرملين": ("RU", "Moscow"), "克里姆林宫": ("RU", "Moscow"), "克里姆林宮": ("RU", "Moscow"),
    # Others
    "Downing Street": ("GB", "London"), "Westminster": ("GB", "London"), "Whitehall": ("GB", "London"),
    "Élysée": ("FR", "Paris"), "Elysée": ("FR", "Paris"), "Elysee Palace": ("FR", "Paris"), "Matignon": ("FR", "Paris"),
    "Bundestag": ("DE", "Berlin"), "Kanzleramt": ("DE", "Berlin"), "Zhongnanhai": ("CN", "Beijing"),
    "中南海": ("CN", "Beijing"), "Knesset": ("IL", "Jerusalem"), "Blue House": ("KR", "Seoul"),
    "Vatican": ("VA", None), "Holy See": ("VA", None),
}  # fmt: skip

LANDMARKS: dict[str, tuple[str, str | None]] = {normalize(k): v for k, v in _LANDMARKS.items()}
