import asyncio

import numpy as np
import pytest
from fastapi.testclient import TestClient

from mapr_embedder.server import Batcher, Settings, create_app


class FakeEncoder:
    model_id = "fake/model"
    dims = 1024

    def __init__(self):
        self.calls = []

    def encode(self, texts, input_type="document", batch_size=32):
        self.calls.append((list(texts), input_type))
        rng = np.random.default_rng(len(texts))
        v = rng.normal(size=(len(texts), self.dims)).astype(np.float32)
        if input_type == "query":
            v[:, 0] += 100.0  # make query vectors distinguishable
        return v / np.linalg.norm(v, axis=1, keepdims=True)


def settings(**kw):
    base = dict(
        model_id="fake/model", revision=None, cache_dir="/tmp", max_seq_length=512, batch_size=4,
        max_texts_per_request=8, max_chars_per_text=50, threads=1, batch_wait_ms=0,
        matryoshka=None, query_prompt_name=None, doc_prompt_name=None,
    )  # fmt: skip
    base.update(kw)
    return Settings(**base)


@pytest.fixture
def client_and_encoder():
    enc = FakeEncoder()
    app = create_app(settings(), encoder_factory=lambda s: enc)
    with TestClient(app) as c:
        yield c, enc


def test_healthz(client_and_encoder):
    c, _ = client_and_encoder
    r = c.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "model": "fake/model", "dims": 1024}


def test_embed_contract(client_and_encoder):
    c, enc = client_and_encoder
    r = c.post("/embed", json={"texts": ["a", "b", "c"]})
    assert r.status_code == 200
    body = r.json()
    assert body["model"] == "fake/model" and body["dims"] == 1024
    v = np.asarray(body["vectors"])
    assert v.shape == (3, 1024)
    assert np.allclose(np.linalg.norm(v, axis=1), 1.0, atol=1e-5)
    assert enc.calls[-1][1] == "document"


def test_embed_query_type_and_truncation(client_and_encoder):
    c, enc = client_and_encoder
    r = c.post("/embed", json={"texts": ["x" * 500], "input_type": "query"})
    assert r.status_code == 200
    texts, kind = enc.calls[-1]
    assert kind == "query" and len(texts[0]) == 50


def test_embed_validation(client_and_encoder):
    c, _ = client_and_encoder
    assert c.post("/embed", json={"texts": []}).status_code == 422
    assert c.post("/embed", json={"texts": ["ok", "  "]}).status_code == 422
    assert c.post("/embed", json={"texts": ["t"] * 9}).status_code == 413
    assert c.post("/embed", json={"texts": ["t"], "input_type": "other"}).status_code == 422
    assert c.post("/embed", json={"inputs": ["t"]}).status_code == 422


def test_healthz_503_while_loading():
    app = create_app(settings(), encoder_factory=lambda s: FakeEncoder())
    c = TestClient(app)  # no context manager -> lifespan not run -> model not loaded
    assert c.get("/healthz").status_code == 503
    assert c.post("/embed", json={"texts": ["a"]}).status_code == 503


def test_model_load_failure_fails_startup():
    def boom(s):
        raise RuntimeError("incompatible")

    app = create_app(settings(), encoder_factory=boom)
    with pytest.raises(RuntimeError), TestClient(app):
        pass


def test_batcher_coalesces_and_splits_results():
    enc = FakeEncoder()

    async def go():
        b = Batcher(enc, batch_size=4, wait_ms=20)
        b.start()
        res = await asyncio.gather(
            b.submit(["a", "b"], "document"),
            b.submit(["c"], "document"),
            b.submit(["q"], "query"),
            b.submit(["d", "e", "f", "g", "h"], "document"),
        )
        await b.stop()
        return res

    res = asyncio.run(go())
    assert [r.shape[0] for r in res] == [2, 1, 1, 5]
    # first two document requests shared one encode call; query never mixed with documents
    assert (["a", "b", "c"], "document") in enc.calls
    assert (["q"], "query") in enc.calls
    assert all(kind == "query" or "q" not in texts for texts, kind in enc.calls)


def test_batcher_propagates_errors():
    class Bad(FakeEncoder):
        def encode(self, texts, input_type="document", batch_size=32):
            raise ValueError("nope")

    async def go():
        b = Batcher(Bad(), batch_size=4, wait_ms=0)
        b.start()
        try:
            await b.submit(["a"], "document")
        finally:
            await b.stop()

    with pytest.raises(ValueError):
        asyncio.run(go())


def test_settings_from_env(monkeypatch):
    monkeypatch.setenv("MODEL_ID", "BAAI/bge-m3")
    monkeypatch.setenv("BATCH_SIZE", "16")
    monkeypatch.setenv("MATRYOSHKA", "true")
    s = Settings.from_env()
    assert s.model_id == "BAAI/bge-m3" and s.batch_size == 16 and s.matryoshka is True and s.threads == 12
