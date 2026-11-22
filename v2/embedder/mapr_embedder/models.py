"""Known embedding models and how to turn each into 1024-dim, L2-normalised vectors.

Kept free of torch / sentence-transformers imports so it can be unit-tested and
imported by the bake-off parent process cheaply.
"""

from __future__ import annotations

from dataclasses import dataclass, field

TARGET_DIMS = 1024


@dataclass(frozen=True)
class ModelSpec:
    model_id: str
    native_dims: int
    # sentence-transformers prompt names (keys of config_sentence_transformers.json "prompts").
    # None = no prompt. Literal prompt strings take precedence when set.
    query_prompt_name: str | None = None
    doc_prompt_name: str | None = None
    query_prompt: str | None = None
    doc_prompt: str | None = None
    matryoshka: bool = False  # trained so that a prefix of the vector is itself a valid embedding
    license: str = ""
    gated: bool = False  # needs an HF token with the licence accepted
    arch: str = ""
    notes: str = ""
    extra_model_kwargs: dict = field(default_factory=dict)


# Repo ids and prompt conventions verified against the model cards (Oct 2026).
REGISTRY: dict[str, ModelSpec] = {
    s.model_id: s
    for s in [
        ModelSpec(
            model_id="microsoft/harrier-oss-v1-0.6b",
            native_dims=1024,
            # Model card: queries use prompt_name="web_search_query"; documents take no instruction.
            query_prompt_name="web_search_query",
            license="MIT",
            arch="Qwen3Model (decoder, last-token pooling)",
            notes="Reported 70.75 multilingual retrieval. Also ships sts_query / bitext_query prompts.",
        ),
        ModelSpec(
            model_id="Qwen/Qwen3-Embedding-0.6B",
            native_dims=1024,
            query_prompt_name="query",  # "Instruct: Given a web search query, ...\nQuery:"
            matryoshka=True,
            license="Apache-2.0",
            arch="Qwen3Model (decoder, last-token pooling)",
        ),
        ModelSpec(
            model_id="BAAI/bge-m3",
            native_dims=1024,
            license="MIT",
            arch="XLMRobertaModel (encoder, CLS pooling)",
            notes="Dense head only; no query instruction.",
        ),
        ModelSpec(
            model_id="google/embeddinggemma-300m",
            native_dims=768,
            query_prompt_name="query",  # "task: search result | query: "
            doc_prompt_name="document",  # "title: none | text: "
            matryoshka=True,  # 768 -> 512/256/128 only; cannot grow to 1024
            license="Gemma",
            gated=True,
            arch="Gemma3TextModel (bidirectional, mean pooling)",
            notes="768 native: incompatible with vector(1024). Evaluated for reference only.",
        ),
    ]
}

DEFAULT_CANDIDATES = list(REGISTRY)


def get_spec(model_id: str, *, native_dims: int | None = None, matryoshka: bool | None = None) -> ModelSpec:
    """Registry entry, or a generic spec for an unknown model (dims discovered at load time)."""
    spec = REGISTRY.get(model_id)
    if spec is None:
        spec = ModelSpec(model_id=model_id, native_dims=native_dims or 0, matryoshka=bool(matryoshka))
    elif matryoshka is not None and matryoshka != spec.matryoshka:
        spec = ModelSpec(**{**spec.__dict__, "matryoshka": matryoshka})
    return spec


@dataclass(frozen=True)
class DimPlan:
    compatible: bool
    truncate_to: int | None  # Matryoshka prefix length, None = use as is
    reason: str


def plan_dims(native_dims: int, matryoshka: bool, target: int = TARGET_DIMS) -> DimPlan:
    """How to get `target` dims from a model: as is, Matryoshka truncation, or not at all.

    Zero-padding is deliberately not offered: it keeps cosines intact but would put
    vectors of a different model geometry into a column that claims to be one space,
    and makes a later switch to a real 1024-dim model silently incompatible.
    """
    if native_dims == target:
        return DimPlan(True, None, "native")
    if native_dims > target and matryoshka:
        return DimPlan(True, target, f"matryoshka truncation {native_dims}->{target}")
    if native_dims > target:
        return DimPlan(False, None, f"{native_dims} dims and no Matryoshka support")
    return DimPlan(False, None, f"{native_dims} dims < {target}; would need padding")
