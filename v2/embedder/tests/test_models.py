import numpy as np
import pytest

from mapr_embedder.encoder import fit_dims, l2_normalise
from mapr_embedder.models import REGISTRY, get_spec, plan_dims


def test_plan_dims():
    assert plan_dims(1024, False).compatible and plan_dims(1024, False).truncate_to is None
    p = plan_dims(2048, True)
    assert p.compatible and p.truncate_to == 1024
    assert not plan_dims(2048, False).compatible
    assert not plan_dims(768, True).compatible  # Matryoshka only shrinks


def test_registry_candidates():
    assert set(REGISTRY) == {
        "microsoft/harrier-oss-v1-0.6b",
        "Qwen/Qwen3-Embedding-0.6B",
        "BAAI/bge-m3",
        "google/embeddinggemma-300m",
    }
    gemma = REGISTRY["google/embeddinggemma-300m"]
    assert not plan_dims(gemma.native_dims, gemma.matryoshka).compatible
    for mid in ("microsoft/harrier-oss-v1-0.6b", "Qwen/Qwen3-Embedding-0.6B", "BAAI/bge-m3"):
        s = REGISTRY[mid]
        assert plan_dims(s.native_dims, s.matryoshka).compatible
    assert REGISTRY["Qwen/Qwen3-Embedding-0.6B"].query_prompt_name == "query"
    assert REGISTRY["microsoft/harrier-oss-v1-0.6b"].query_prompt_name == "web_search_query"


def test_get_spec_unknown_and_override():
    s = get_spec("some/model", native_dims=2048, matryoshka=True)
    assert s.native_dims == 2048 and s.matryoshka
    assert get_spec("BAAI/bge-m3", matryoshka=True).matryoshka
    assert not REGISTRY["BAAI/bge-m3"].matryoshka  # registry untouched


def test_fit_dims_truncates_and_renormalises():
    rng = np.random.default_rng(0)
    v = rng.normal(size=(5, 2048)).astype(np.float32)
    out = fit_dims(v, plan_dims(2048, True))
    assert out.shape == (5, 1024) and out.dtype == np.float32
    assert np.allclose(np.linalg.norm(out, axis=1), 1.0, atol=1e-5)
    assert np.allclose(out, l2_normalise(v[:, :1024]))
    same = fit_dims(v[:, :1024], plan_dims(1024, False))
    assert np.allclose(np.linalg.norm(same, axis=1), 1.0, atol=1e-5)


def test_l2_normalise_zero_row():
    out = l2_normalise(np.zeros((1, 4)))
    assert np.all(out == 0)


@pytest.mark.parametrize("n", [0])
def test_l2_normalise_empty(n):
    assert l2_normalise(np.zeros((n, 4))).shape == (0, 4)
