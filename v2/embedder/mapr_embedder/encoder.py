"""sentence-transformers wrapper shared by the service and the bake-off.

Guarantees: float32, exactly `target_dims` columns (when the model is compatible),
every row L2-normalised.
"""

from __future__ import annotations

import contextlib
import logging
import os
import time
from typing import Literal

import numpy as np

from .models import TARGET_DIMS, DimPlan, ModelSpec, get_spec, plan_dims

log = logging.getLogger(__name__)

InputType = Literal["document", "query"]


def l2_normalise(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=np.float32)
    norms = np.linalg.norm(x, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return (x / norms).astype(np.float32)


def fit_dims(vecs: np.ndarray, plan: DimPlan) -> np.ndarray:
    """Apply the dim plan (Matryoshka prefix) and re-normalise."""
    if plan.truncate_to is not None:
        vecs = vecs[:, : plan.truncate_to]
    return l2_normalise(vecs)


def configure_threads(n: int) -> None:
    import torch

    torch.set_num_threads(n)
    # Inter-op parallelism only helps with many independent ops; 1 avoids oversubscription.
    with contextlib.suppress(RuntimeError):  # can only be set once per process
        torch.set_num_interop_threads(1)


class Encoder:
    def __init__(
        self,
        model_id: str,
        *,
        cache_dir: str | None = None,
        revision: str | None = None,
        max_seq_length: int = 512,
        threads: int | None = None,
        target_dims: int = TARGET_DIMS,
        matryoshka: bool | None = None,
        require_compatible: bool = True,
        query_prompt_name: str | None = None,
        doc_prompt_name: str | None = None,
    ) -> None:
        from sentence_transformers import SentenceTransformer

        if threads:
            configure_threads(threads)
        t0 = time.perf_counter()
        self.model = SentenceTransformer(
            model_id,
            device="cpu",
            cache_folder=cache_dir,
            revision=revision,
            token=os.environ.get("HF_TOKEN") or None,
            trust_remote_code=False,
        )
        self.load_seconds = time.perf_counter() - t0
        self.model.max_seq_length = max_seq_length
        self.model.eval()

        # sentence-transformers renamed this accessor in newer releases; accept either.
        dim_fn = getattr(self.model, "get_embedding_dimension", None) or self.model.get_sentence_embedding_dimension
        native = int(dim_fn())
        self.spec: ModelSpec = get_spec(model_id, native_dims=native, matryoshka=matryoshka)
        if self.spec.native_dims and self.spec.native_dims != native:
            log.warning("registry says %s dims for %s, model reports %s", self.spec.native_dims, model_id, native)
        self.native_dims = native
        self.plan = plan_dims(native, self.spec.matryoshka, target_dims)
        if require_compatible and not self.plan.compatible:
            raise RuntimeError(f"{model_id} is incompatible with vector({target_dims}): {self.plan.reason}")
        self.dims = target_dims if self.plan.compatible else native
        self.model_id = model_id

        prompts = getattr(self.model, "prompts", {}) or {}
        self.prompt_names: dict[str, str | None] = {}
        for kind, override, default in (
            ("query", query_prompt_name, self.spec.query_prompt_name),
            ("document", doc_prompt_name, self.spec.doc_prompt_name),
        ):
            name = override if override is not None else default
            if name == "":
                name = None
            if name is not None and name not in prompts:
                log.warning(
                    "%s has no prompt %r (has %s); encoding %ss without one", model_id, name, list(prompts), kind
                )
                name = None
            self.prompt_names[kind] = name
        self.literal_prompts = {"query": self.spec.query_prompt, "document": self.spec.doc_prompt}
        log.info(
            "loaded %s in %.1fs: native=%d out=%d (%s) prompts=%s",
            model_id,
            self.load_seconds,
            native,
            self.dims,
            self.plan.reason,
            self.prompt_names,
        )

    def encode(self, texts: list[str], input_type: InputType = "document", batch_size: int = 32) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dims), dtype=np.float32)
        kwargs: dict = {}
        literal = self.literal_prompts.get(input_type)
        if literal:
            kwargs["prompt"] = literal
        elif self.prompt_names.get(input_type):
            kwargs["prompt_name"] = self.prompt_names[input_type]
        vecs = self.model.encode(
            texts,
            batch_size=batch_size,
            convert_to_numpy=True,
            normalize_embeddings=False,  # normalise after any truncation
            show_progress_bar=False,
            **kwargs,
        )
        return fit_dims(np.asarray(vecs, dtype=np.float32), self.plan)
