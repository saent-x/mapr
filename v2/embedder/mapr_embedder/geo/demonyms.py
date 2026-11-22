"""Words that name a country without being its name.

ALIASES are abbreviations and short forms the gazetteer build skips as codes ("US", "UAE").
DEMONYMS are adjectives ("Ukrainian forces"): the NER model tags them MISC, not LOC, but in a
headline they are often the only clue to where something happened.
"""

from __future__ import annotations

from .text import normalize

ALIASES: dict[str, str] = {
    "US": "US", "U.S.": "US", "USA": "US", "U.S.A.": "US", "America": "US", "United States": "US",
    "UK": "GB", "U.K.": "GB", "Britain": "GB", "Great Britain": "GB", "England": "GB", "Scotland": "GB", "Wales": "GB",
    "Northern Ireland": "GB", "UAE": "AE", "DRC": "CD", "DR Congo": "CD", "Congo-Kinshasa": "CD",
    "Congo-Brazzaville": "CG", "CAR": "CF", "PRC": "CN", "Mainland China": "CN", "ROK": "KR", "DPRK": "KP",
    "North Korea": "KP", "South Korea": "KR", "Russia": "RU", "Iran": "IR", "Syria": "SY", "Laos": "LA",
    "Vietnam": "VN", "Bolivia": "BO", "Venezuela": "VE", "Tanzania": "TZ", "Moldova": "MD", "Turkey": "TR",
    "Türkiye": "TR", "Czechia": "CZ", "Czech Republic": "CZ", "Ivory Coast": "CI", "Burma": "MM", "Myanmar": "MM",
    "Palestine": "PS", "West Bank": "PS", "Gaza": "PS", "Gaza Strip": "PS", "Holland": "NL", "Vatican": "VA",
    "East Timor": "TL", "Timor-Leste": "TL", "Eswatini": "SZ", "Swaziland": "SZ", "Cape Verde": "CV",
    "Macedonia": "MK", "North Macedonia": "MK", "Micronesia": "FM", "Brunei": "BN", "Kosovo": "XK",
}  # fmt: skip

_DEMONYMS: dict[str, str] = {
    "Afghan": "AF", "Albanian": "AL", "Algerian": "DZ", "American": "US", "Angolan": "AO", "Argentine": "AR",
    "Argentinian": "AR", "Armenian": "AM", "Australian": "AU", "Austrian": "AT", "Azerbaijani": "AZ", "Azeri": "AZ",
    "Bahraini": "BH", "Bangladeshi": "BD", "Belarusian": "BY", "Belgian": "BE", "Beninese": "BJ", "Bhutanese": "BT",
    "Bolivian": "BO", "Bosnian": "BA", "Brazilian": "BR", "British": "GB", "Bulgarian": "BG", "Burkinabe": "BF",
    "Burmese": "MM", "Burundian": "BI", "Cambodian": "KH", "Cameroonian": "CM", "Canadian": "CA", "Chadian": "TD",
    "Chilean": "CL", "Chinese": "CN", "Colombian": "CO", "Congolese": "CD", "Costa Rican": "CR", "Croatian": "HR",
    "Cuban": "CU", "Cypriot": "CY", "Czech": "CZ", "Danish": "DK", "Djiboutian": "DJ", "Dominican": "DO", "Dutch": "NL",
    "Ecuadorian": "EC", "Egyptian": "EG", "Emirati": "AE", "English": "GB", "Eritrean": "ER", "Estonian": "EE",
    "Ethiopian": "ET", "Fijian": "FJ", "Filipino": "PH", "Finnish": "FI", "French": "FR", "Gabonese": "GA",
    "Gambian": "GM", "Georgian": "GE", "German": "DE", "Ghanaian": "GH", "Greek": "GR", "Guatemalan": "GT",
    "Guinean": "GN", "Guyanese": "GY", "Haitian": "HT", "Honduran": "HN", "Hungarian": "HU", "Icelandic": "IS",
    "Indian": "IN", "Indonesian": "ID", "Iranian": "IR", "Iraqi": "IQ", "Irish": "IE", "Israeli": "IL", "Italian": "IT",
    "Ivorian": "CI", "Jamaican": "JM", "Japanese": "JP", "Jordanian": "JO", "Kazakh": "KZ", "Kenyan": "KE",
    "Kosovar": "XK", "Kuwaiti": "KW", "Kyrgyz": "KG", "Lao": "LA", "Laotian": "LA", "Latvian": "LV", "Lebanese": "LB",
    "Liberian": "LR", "Libyan": "LY", "Lithuanian": "LT", "Luxembourgish": "LU", "Macedonian": "MK", "Malagasy": "MG",
    "Malawian": "MW", "Malaysian": "MY", "Maldivian": "MV", "Malian": "ML", "Maltese": "MT", "Mauritanian": "MR",
    "Mauritian": "MU", "Mexican": "MX", "Moldovan": "MD", "Mongolian": "MN", "Montenegrin": "ME", "Moroccan": "MA",
    "Mozambican": "MZ", "Namibian": "NA", "Nepalese": "NP", "Nepali": "NP", "New Zealand": "NZ", "Nicaraguan": "NI",
    "Nigerian": "NG", "Nigerien": "NE", "North Korean": "KP", "Norwegian": "NO", "Omani": "OM", "Pakistani": "PK",
    "Palestinian": "PS", "Panamanian": "PA", "Paraguayan": "PY", "Peruvian": "PE", "Philippine": "PH", "Polish": "PL",
    "Portuguese": "PT", "Qatari": "QA", "Romanian": "RO", "Russian": "RU", "Rwandan": "RW", "Salvadoran": "SV",
    "Saudi": "SA", "Scottish": "GB", "Senegalese": "SN", "Serbian": "RS", "Sierra Leonean": "SL", "Singaporean": "SG",
    "Slovak": "SK", "Slovenian": "SI", "Somali": "SO", "South African": "ZA", "South Korean": "KR",
    "South Sudanese": "SS", "Spanish": "ES", "Sri Lankan": "LK", "Sudanese": "SD", "Surinamese": "SR", "Swedish": "SE",
    "Swiss": "CH", "Syrian": "SY", "Taiwanese": "TW", "Tajik": "TJ", "Tanzanian": "TZ", "Thai": "TH", "Togolese": "TG",
    "Tunisian": "TN", "Turkish": "TR", "Turkmen": "TM", "Ugandan": "UG", "Ukrainian": "UA", "Uruguayan": "UY",
    "Uzbek": "UZ", "Venezuelan": "VE", "Vietnamese": "VN", "Welsh": "GB", "Yemeni": "YE", "Zambian": "ZM",
    "Zimbabwean": "ZW", "Crimean": "UA", "Chechen": "RU", "Tibetan": "CN",
    "Bahamian": "BS", "Barbadian": "BB", "Trinidadian": "TT", "Belizean": "BZ", "Botswanan": "BW", "Motswana": "BW",
    "Basotho": "LS", "Equatoguinean": "GQ", "Comorian": "KM", "Seychellois": "SC", "Papua New Guinean": "PG",
    "Samoan": "WS", "Tongan": "TO", "Vanuatuan": "VU", "Solomon Islander": "SB", "Bruneian": "BN", "Timorese": "TL",
}  # fmt: skip

DEMONYMS: dict[str, str] = {
    normalize(k): v for k, v in {**_DEMONYMS, **{d + "s": c for d, c in _DEMONYMS.items()}}.items()
}
ALIAS_KEYS: dict[str, str] = {normalize(k): v for k, v in ALIASES.items()}
