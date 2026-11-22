"""Multilingual named-entity models (Hugging Face token classification), CPU only.

The main model (wikineural, 9 European languages) misreads Chinese, Japanese and Arabic headlines,
which several MAPR feeds publish. Texts in those scripts go to a second model trained on them
(xlm-roberta HRL: Arabic, Chinese and 8 more). If the second model cannot load, everything goes
to the main one.
"""

from __future__ import annotations

import logging
import os
import time
import unicodedata

from .resolve import Entity

log = logging.getLogger(__name__)

DEFAULT_MODEL = "Babelscape/wikineural-multilingual-ner"
DEFAULT_SCRIPT_MODEL = "Davlan/xlm-roberta-base-ner-hrl"
ROUTED_SCRIPTS = ("CJK", "HIRAGANA", "KATAKANA", "ARABIC")


def script_of(text: str) -> str | None:
    """The routed script that most letters of `text` are in, if letters in such scripts are at least a third."""
    counts: dict[str, int] = {}
    letters = 0
    for ch in text:
        if not ch.isalpha():
            continue
        letters += 1
        name = unicodedata.name(ch, "")
        for s in ROUTED_SCRIPTS:
            if name.startswith(s):
                counts[s] = counts.get(s, 0) + 1
                break
    if not counts or sum(counts.values()) * 3 < letters:
        return None
    return max(counts, key=lambda s: counts[s])


def _load(model_id: str, cache_dir: str | None, revision: str | None):
    from transformers import AutoModelForTokenClassification, AutoTokenizer, pipeline

    token = os.environ.get("HF_TOKEN") or None
    tok = AutoTokenizer.from_pretrained(model_id, cache_dir=cache_dir, revision=revision, token=token)
    model = AutoModelForTokenClassification.from_pretrained(
        model_id, cache_dir=cache_dir, revision=revision, token=token
    )
    model.eval()
    return pipeline("token-classification", model=model, tokenizer=tok, aggregation_strategy="simple", device=-1)


def _entities(pipe, texts: list[str], batch_size: int) -> list[list[Entity]]:
    if not texts:
        return []
    out = pipe(texts, batch_size=batch_size)
    if len(texts) == 1 and (not out or isinstance(out[0], dict)):  # a single text can come back unwrapped
        out = [out]
    return [
        [
            Entity(text[e["start"] : e["end"]].strip(), str(e["entity_group"]), float(e["score"]))
            for e in ents
            if e.get("start") is not None and e.get("end") is not None
        ]
        for text, ents in zip(texts, out, strict=True)
    ]


class Ner:
    def __init__(
        self,
        model_id: str = DEFAULT_MODEL,
        *,
        script_model_id: str | None = DEFAULT_SCRIPT_MODEL,
        cache_dir: str | None = None,
        revision: str | None = None,
        loader=_load,
    ) -> None:
        t0 = time.perf_counter()
        self.pipe = loader(model_id, cache_dir, revision)
        self.script_pipe = None
        if script_model_id:
            try:
                self.script_pipe = loader(script_model_id, cache_dir, None)
            except Exception:
                log.exception("NER %s did not load; all scripts go to %s", script_model_id, model_id)
        self.model_id = model_id if not self.script_pipe else f"{model_id}+{script_model_id}"
        log.info("loaded NER %s in %.1fs", self.model_id, time.perf_counter() - t0)

    def extract(self, texts: list[str], batch_size: int = 16) -> list[list[Entity]]:
        if not self.script_pipe:
            return _entities(self.pipe, texts, batch_size)
        routed = [i for i, t in enumerate(texts) if script_of(t)]
        rest = [i for i, t in enumerate(texts) if i not in set(routed)]
        out: list[list[Entity]] = [[] for _ in texts]
        for idx, pipe in ((rest, self.pipe), (routed, self.script_pipe)):
            for i, ents in zip(idx, _entities(pipe, [texts[i] for i in idx], batch_size), strict=True):
                out[i] = ents
        return out
