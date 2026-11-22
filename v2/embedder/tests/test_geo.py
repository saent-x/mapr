import gzip

import pytest
from fastapi.testclient import TestClient

from mapr_embedder.geo.build import country_names, parse
from mapr_embedder.geo.gazetteer import Gazetteer, write
from mapr_embedder.geo.resolve import Entity, mentions_for, resolve
from mapr_embedder.geo.service import GeoService
from mapr_embedder.geo.text import normalize, variants
from mapr_embedder.server import create_app
from tests.test_server import FakeEncoder, settings

# geonameid name asciiname alternatenames lat lon fclass fcode cc cc2 admin1 admin2 admin3 admin4 pop elev dem tz date
ROWS = [
    ("690791", "Ukraine", "Ukraine", "Ukraina,Украина,Україна,UKR", 49, 32, "A", "PCLI", "UA", "", "00", 41000000),
    ("706483", "Kharkiv", "Kharkiv", "Kharkov,Харків,Харьков", 49.98, 36.25, "P", "PPLA", "UA", "", "07", 1430000),
    ("703448", "Kyiv", "Kyiv", "Kiev,Kyjiw,Київ", 50.45, 30.52, "P", "PPLC", "UA", "", "12", 2900000),
    (
        "709716",
        "Donetsk Oblast",
        "Donetsk Oblast",
        "Donetsk,Donetska oblast,Донецкая область",
        48,
        37.8,
        "A",
        "ADM1",
        "UA",
        "",
        "05",
        4100000,
    ),
    ("614540", "Georgia", "Georgia", "Sakartvelo,Géorgie,Georgien", 42, 43.5, "A", "PCLI", "GE", "", "00", 3700000),
    (
        "4197000",
        "Georgia",
        "Georgia",
        "GA,Géorgie (État),Georgia State",
        32.75,
        -83.5,
        "A",
        "ADM1",
        "US",
        "",
        "GA",
        10500000,
    ),
    ("4180439", "Atlanta", "Atlanta", "Atlanta GA,Atlante,Атланта", 33.75, -84.39, "P", "PPLA", "US", "", "GA", 498000),
    (
        "6252001",
        "United States",
        "United States",
        "USA,United States of America,Amerika",
        39.76,
        -98.5,
        "A",
        "PCLI",
        "US",
        "",
        "00",
        327000000,
    ),
    ("2988507", "Paris", "Paris", "Parigi,Parijs,Париж", 48.85, 2.35, "P", "PPLC", "FR", "", "11", 2138000),
    ("4717560", "Paris", "Paris", "", 33.66, -95.55, "P", "PPLA2", "US", "", "TX", 24700),
    ("3017382", "France", "France", "Frankreich,Francia,Франция", 46, 2, "A", "PCLI", "FR", "", "00", 66000000),
    ("294640", "Israel", "Israel", "Israël,Isreal,Израиль", 31.5, 34.75, "A", "PCLI", "IL", "", "00", 8800000),
    ("350155", "Red Sea", "Red Sea", "Mer Rouge,Rotes Meer,Mar Rojo", 20, 38, "H", "SEA", "", "", "", 0),
    (
        "1733037",
        "Selangor",
        "Selangor",
        "Negeri Selangor,Selangor Darul Ehsan",
        3.33,
        101.5,
        "A",
        "ADM1",
        "MY",
        "",
        "12",
        5400000,
    ),
    (
        "1732905",
        "Kuala Selangor",
        "Kuala Selangor",
        "Selangor,Kuala Selangor Town",
        3.34,
        101.25,
        "P",
        "PPLA2",
        "MY",
        "",
        "12",
        60000,
    ),
    ("1668341", "Taipei", "Taipei", "Taipei City,臺北市,台北", 25.05, 121.53, "P", "PPLC", "TW", "", "03", 7871900),
    ("1675151", "Hsinchu", "Hsinchu", "新竹市,新竹", 24.8, 120.97, "P", "PPLA", "TW", "", "04", 404109),
    ("123", "Tinyville", "Tinyville", "Tiny Town", 10, 10, "P", "PPL", "FR", "", "11", 300),
    ("124", "Smalltown", "Smalltown", "Petite Ville,Kleinstadt", 11, 11, "P", "PPL", "FR", "", "11", 8000),
]


def dump_lines(rows=ROWS):
    for gid, name, ascii_, alts, lat, lon, fc, code, cc, cc2, a1, pop in rows:
        yield (
            "\t".join(
                [
                    gid,
                    name,
                    ascii_,
                    alts,
                    str(lat),
                    str(lon),
                    fc,
                    code,
                    cc,
                    cc2,
                    a1,
                    "",
                    "",
                    "",
                    str(pop),
                    "",
                    "",
                    "",
                    "",
                ]
            )
            + "\n"
        )


@pytest.fixture(scope="module")
def gaz(tmp_path_factory):
    path = tmp_path_factory.mktemp("geo") / "gaz.tsv.gz"
    write(path, parse(dump_lines(), {"UA": "Ukraine", "US": "United States"}))
    return Gazetteer.load(path)


def test_normalize_and_variants():
    assert normalize("Côte d'Ivoire") == "cote divoire"
    assert normalize("Ukraine's") == "ukraine"
    assert normalize("  São   Paulo ") == "sao paulo"
    assert normalize("Київ") == "киів"
    assert variants("eastern ukraine") == ["eastern ukraine", "ukraine"]
    assert variants("donetsk region") == ["donetsk region", "donetsk"]
    assert variants("south africa")[0] == "south africa"


def test_build_filters_and_keys(gaz):
    names = {p.name for p in gaz.places}
    assert "Tinyville" not in names  # under 5,000 people and not a seat
    assert "Smalltown" in names
    assert gaz.lookup("kleinstadt") == []  # small towns: own name only
    assert gaz.lookup("kiev")[0].name == "Kyiv"
    assert gaz.lookup("ukr") == []  # codes are not names
    assert gaz.country("UA").lat == 49
    assert {p.cc for p in gaz.lookup("us")} == {"US"}  # alias added to the country
    assert gaz.lookup("red sea")[0].kind == "water" and gaz.lookup("red sea")[0].cc == ""


def test_country_names_reader(tmp_path):
    f = tmp_path / "countryInfo.txt"
    f.write_text("#ISO\tISO3\tnum\tfips\tCountry\n" + "TR\tTUR\t792\tTU\tTurkey\n", encoding="utf-8")
    assert country_names(f) == {"TR": "Turkey"}


def go(gaz, ents, sources=()):
    return resolve(gaz, mentions_for(gaz, [(Entity(t, lab, 0.99), w) for t, lab, w in ents]), list(sources))


def test_city_inside_named_country(gaz):
    r = go(gaz, [("Ukraine", "LOC", 3), ("Kharkiv", "LOC", 1)])
    assert (r.place, r.country, r.precision) == ("Kharkiv", "UA", "city")
    assert (r.lat, r.lon) == (49.98, 36.25)


def test_country_only_uses_country_point(gaz):
    r = go(gaz, [("Ukraine's", "LOC", 3)])
    assert (r.place, r.country, r.precision, r.lat) == ("Ukraine", "UA", "country", 49)


def test_demonym(gaz):
    r = go(gaz, [("Israeli", "MISC", 3)])
    assert r.country == "IL"
    assert go(gaz, [("Ukrainians", "MISC", 1)]).country == "UA"


def test_ambiguous_name_follows_context(gaz):
    assert go(gaz, [("Georgia", "LOC", 3)]).country == "GE"
    r = go(gaz, [("Georgia", "LOC", 3), ("Atlanta", "LOC", 1)])
    assert (r.country, r.place) == ("US", "Atlanta")


def test_big_city_beats_namesake_even_from_local_outlet(gaz):
    assert go(gaz, [("Paris", "LOC", 3)], sources=["US"]).country == "FR"


def test_majority_country_wins(gaz):
    r = go(gaz, [("Kyiv", "LOC", 3), ("Paris", "LOC", 1), ("Kharkiv", "LOC", 1)])
    assert r.country == "UA" and r.place in ("Kyiv", "Kharkiv")
    assert r.confidence == pytest.approx(4 / 5, abs=0.01)


def test_own_name_beats_alternate_name(gaz):
    r = go(gaz, [("Selangor", "LOC", 3)])
    assert (r.place, r.precision) == ("Selangor", "admin1")


def test_cjk_city_suffix_and_tai_forms(gaz):
    assert "台北" in variants("台北市") and "臺北市" in variants("台北市")
    r = go(gaz, [("台北市", "LOC", 3), ("新竹", "LOC", 0.5)])
    assert (r.place, r.country) == ("Taipei", "TW")


def test_variants_and_admin1(gaz):
    r = go(gaz, [("Donetsk region", "LOC", 3)])
    assert (r.place, r.country, r.precision) == ("Donetsk Oblast", "UA", "admin1")


def test_water_only(gaz):
    r = go(gaz, [("Red Sea", "LOC", 3)])
    assert (r.place, r.country, r.precision) == ("Red Sea", None, "water")


def test_source_country_fallback_and_nothing(gaz):
    assert go(gaz, [], sources=["UA"]).precision == "source"
    assert go(gaz, [], sources=["UA", "FR"]).country is None
    assert go(gaz, [("Nowhereland", "LOC", 3), ("Bob", "PER", 3)]).country is None


def test_low_confidence_entities_ignored(gaz):
    m = mentions_for(gaz, [(Entity("Ukraine", "LOC", 0.3), 3)])
    assert m == []


class FakeNer:
    model_id = "fake/ner"

    def __init__(self, table):
        self.table = table
        self.calls = []

    def extract(self, texts, batch_size=16):
        self.calls.append(list(texts))
        return [[Entity(w, lab, 0.95) for w, lab in self.table.get(t, [])] for t in texts]


def test_service_splits_entities_per_event(gaz):
    ner = FakeNer({"Strike on Kharkiv": [("Kharkiv", "LOC")], "Paris talks": [("Paris", "LOC")]})
    svc = GeoService(ner, gaz)
    out = svc.geocode([([("Strike on Kharkiv", 3.0), ("nothing here", 1.0)], []), ([("Paris talks", 3.0)], ["FR"])])
    assert [r["place"] for r in out] == ["Kharkiv", "Paris"]
    assert len(ner.calls) == 1 and len(ner.calls[0]) == 3


def test_geocode_endpoint(gaz, tmp_path):
    ner = FakeNer({"Strike on Kharkiv": [("Kharkiv", "LOC")]})
    s = settings(gazetteer_path=str(tmp_path / "unused.tsv.gz"))
    app = create_app(s, encoder_factory=lambda _: FakeEncoder(), geo_factory=lambda _: GeoService(ner, gaz))
    with TestClient(app) as c:
        # The geocoder loads in the background after the encoder; TestClient startup waits for neither.
        for _ in range(200):
            if c.get("/healthz").json().get("geo") == "ok":
                break
        r = c.post(
            "/geocode",
            json={
                "events": [
                    {"texts": [{"text": "Strike on Kharkiv", "weight": 3}], "source_countries": ["ua", "GLOBAL"]}
                ]
            },
        )
        assert r.status_code == 200
        assert r.json()["results"][0] | {"confidence": 1} == {
            "place": "Kharkiv", "country": "UA", "lat": 49.98, "lon": 36.25, "precision": "city", "confidence": 1,
        }  # fmt: skip
        assert c.post("/geocode", json={"events": []}).status_code == 422


def test_geocode_503_when_gazetteer_fails(tmp_path):
    def boom(_):
        raise FileNotFoundError("no gazetteer")

    s = settings(gazetteer_path=str(tmp_path / "missing.tsv.gz"))
    app = create_app(s, encoder_factory=lambda _: FakeEncoder(), geo_factory=boom)
    with TestClient(app) as c:
        for _ in range(200):
            if c.get("/healthz").json().get("geo") == "error":
                break
        assert c.get("/healthz").status_code == 200  # embeddings still served
        r = c.post("/geocode", json={"events": [{"texts": [{"text": "x"}]}]})
        assert r.status_code == 503 and "no gazetteer" in r.json()["detail"]


def test_gazetteer_file_is_gzip_tsv(tmp_path):
    p = tmp_path / "g.tsv.gz"
    write(p, parse(dump_lines(ROWS[:1]), {}))
    with gzip.open(p, "rt") as f:
        line = f.readline().rstrip("\n").split("\t")
    assert line[:3] == ["country", "UA", "00"] and "ukraina" in line[8].split("|")


def test_build_cli_refuses_a_tiny_dump(tmp_path):
    from mapr_embedder.geo.build import main

    dump = tmp_path / "allCountries.txt"
    dump.write_text("".join(dump_lines()), encoding="utf-8")
    out = tmp_path / "gaz.tsv.gz"
    with pytest.raises(SystemExit, match="gazetteer not replaced"):
        main(["--dump", str(dump), "--out", str(out)])
    assert not out.exists()
