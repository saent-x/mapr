"""Multilingual named-entity model (Hugging Face token classification), CPU only."""

from __future__ import annotations

import logging
import os
import time

from .resolve import Entity

log = logging.getLogger(__name__)

DEFAULT_MODEL = "Babelscape/wikineural-multilingual-ner"


class Ner:
    def __init__(
        self, model_id: str = DEFAULT_MODEL, *, cache_dir: str | None = None, revision: str | None = None
    ) -> None:
        from transformers import AutoModelForTokenClassification, AutoTokenizer, pipeline

        t0 = time.perf_counter()
        token = os.environ.get("HF_TOKEN") or None
        tok = AutoTokenizer.from_pretrained(model_id, cache_dir=cache_dir, revision=revision, token=token)
        model = AutoModelForTokenClassification.from_pretrained(
            model_id, cache_dir=cache_dir, revision=revision, token=token
        )
        model.eval()
        self.pipe = pipeline(
            "token-classification", model=model, tokenizer=tok, aggregation_strategy="simple", device=-1
        )
        self.model_id = model_id
        log.info("loaded NER %s in %.1fs", model_id, time.perf_counter() - t0)

    def extract(self, texts: list[str], batch_size: int = 16) -> list[list[Entity]]:
        if not texts:
            return []
        out = self.pipe(texts, batch_size=batch_size)
        if len(texts) == 1 and (not out or isinstance(out[0], dict)):  # a single text can come back unwrapped
            out = [out]
        result = []
        for text, ents in zip(texts, out, strict=True):
            result.append(
                [
                    Entity(text[e["start"] : e["end"]].strip(), str(e["entity_group"]), float(e["score"]))
                    for e in ents
                    if e.get("start") is not None and e.get("end") is not None
                ]
            )
        return result
