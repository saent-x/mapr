import json
from pathlib import Path

import numpy as np
import pytest

from bakeoff import run as R

HERE = Path(__file__).resolve().parents[1] / "bakeoff"


def fake_vectors(rows, queries, noise, dims=1024, seed=0):
    """Vectors near a per-event centre: small noise = a 'good model'."""
    rng = np.random.default_rng(seed)
    centres = {}

    def centre(e):
        if e not in centres:
            centres[e] = rng.normal(size=dims)
        return centres[e]

    by_id = {r["id"]: r for r in rows}
    d = np.stack([centre(r["event_id"]) + noise * rng.normal(size=dims) for r in rows])
    q = np.stack([centre(by_id[x["query_article_id"]]["event_id"]) + noise * rng.normal(size=dims) for x in queries])
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    return d.astype(np.float32), q.astype(np.float32)


@pytest.fixture(scope="module")
def data():
    if not (HERE / "dataset.jsonl").exists():
        pytest.skip("dataset not built")
    return R.load_jsonl(HERE / "dataset.jsonl"), R.load_jsonl(HERE / "queries.jsonl")


def test_score_good_vs_bad_model(data):
    rows, queries = data
    good = R.score(rows, queries, *fake_vectors(rows, queries, noise=0.3))
    bad = R.score(rows, queries, *fake_vectors(rows, queries, noise=15.0))
    assert good["separation"]["auc"] > 0.99 > bad["separation"]["auc"]
    g = good["clustering_at_best_threshold"]["bcubed_anchored"]["f1"]
    b = bad["clustering_at_best_threshold"]["bcubed_anchored"]["f1"]
    assert g > b
    # the 48h window caps recall even for a perfect model (labels may span up to 72h)
    assert g > 0.8
    assert good["retrieval"]["recall@10"] > bad["retrieval"]["recall@10"]
    assert good["retrieval"]["queries"] == len(queries)
    assert len(good["threshold_sweep"]) == len(R.SWEEP)


def test_parent_end_to_end_with_failure(tmp_path, data, monkeypatch):
    rows, queries = data
    vec = fake_vectors(rows, queries, noise=0.5)

    def fake_ensure(args, model, key):
        run_dir = Path(args.out) / "runs" / R.slug(model)
        run_dir.mkdir(parents=True, exist_ok=True)
        if model == "broken/model":
            return {"model": model, "status": "error", "error": "measure exited -9 (killed: out of memory?)"}
        np.savez(run_dir / "vectors.npz", docs=vec[0], queries=vec[1])
        return {
            "model": model, "status": "ok", "run_key": key, "native_dims": 1024, "out_dims": 1024,
            "dim_plan": "native", "compatible_1024": model != "google/embeddinggemma-300m", "prompts": {},
            "load_seconds": 1.0, "docs_per_second": 50.0 if model == "BAAI/bge-m3" else 40.0,
            "queries_per_second": 80.0, "peak_rss_mb": 2000.0, "batch_size": 32, "torch_threads": 12,
            "mean_tokens": 40.0, "p95_tokens": 90, "truncated_fraction": 0.0,
        }  # fmt: skip

    monkeypatch.setattr(R, "ensure_vectors", fake_ensure)
    models = ["BAAI/bge-m3", "broken/model", "google/embeddinggemma-300m", "Qwen/Qwen3-Embedding-0.6B"]
    rc = R.main(["--out", str(tmp_path), "--models", *models, "--cache-dir", str(tmp_path / "cache")])
    assert rc == 0
    res = json.loads((tmp_path / "results.json").read_text())
    status = {r["model"]: r["status"] for r in res["results"]}
    assert status == {"BAAI/bge-m3": "ok", "broken/model": "error", "google/embeddinggemma-300m": "ok",
                      "Qwen/Qwen3-Embedding-0.6B": "ok"}  # fmt: skip
    # identical quality -> faster compatible model wins; the incompatible one never does
    assert res["winner"] == "BAAI/bge-m3"
    md = (tmp_path / "results.md").read_text()
    assert "broken/model" in md and "Recommendation" in md and "NO (1024)" in md


def test_run_key_changes_with_settings(tmp_path):
    d = tmp_path / "d.jsonl"
    q = tmp_path / "q.jsonl"
    d.write_text("{}\n")
    q.write_text("{}\n")

    class A:
        batch_size, max_seq_length, threads = 32, 512, 12

    k1 = R.run_key(A, d, q)
    A.batch_size = 16
    assert R.run_key(A, d, q) != k1
    d.write_text('{"x": 1}\n')
    assert R.run_key(A, d, q) != k1


def test_ensure_vectors_uses_cache(tmp_path, monkeypatch):
    class A:
        out, force = str(tmp_path), False

    run_dir = tmp_path / "runs" / R.slug("m/x")
    run_dir.mkdir(parents=True)
    (run_dir / "vectors.npz").write_bytes(b"")
    (run_dir / "meta.json").write_text(json.dumps({"status": "ok", "run_key": "k1"}))
    monkeypatch.setattr(R, "spawn", lambda *a, **k: pytest.fail("should not spawn"))
    assert R.ensure_vectors(A, "m/x", "k1")["status"] == "ok"
