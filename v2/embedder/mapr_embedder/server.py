"""MAPR embedding service.

POST /embed   {"texts": [...], "input_type": "document"|"query"}  (input_type optional, default document)
          ->  {"vectors": [[...]], "model": "<id>", "dims": 1024}
GET  /healthz -> 200 {"status": "ok", ...} once the model is loaded, 503 before.

Requests are queued and coalesced into batches of up to BATCH_SIZE texts so many
small calls (search queries) share one forward pass. One model, one worker: torch
already uses every core, so running requests in parallel only adds contention.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Callable
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from typing import Literal, Protocol

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

log = logging.getLogger("mapr_embedder")


class EncoderLike(Protocol):
    model_id: str
    dims: int

    def encode(self, texts: list[str], input_type: str = ..., batch_size: int = ...) -> np.ndarray: ...


@dataclass(frozen=True)
class Settings:
    model_id: str
    revision: str | None
    cache_dir: str
    max_seq_length: int
    batch_size: int
    max_texts_per_request: int
    max_chars_per_text: int
    threads: int
    batch_wait_ms: float
    matryoshka: bool | None
    query_prompt_name: str | None
    doc_prompt_name: str | None

    @classmethod
    def from_env(cls) -> Settings:
        env = os.environ.get

        def opt_bool(name: str) -> bool | None:
            v = env(name)
            return None if v in (None, "") else v.lower() in ("1", "true", "yes")

        return cls(
            model_id=env("MODEL_ID", "BAAI/bge-m3"),
            revision=env("MODEL_REVISION") or None,
            cache_dir=env("MODEL_CACHE_DIR", "/models"),
            max_seq_length=int(env("MAX_SEQ_LENGTH", "512")),
            batch_size=int(env("BATCH_SIZE", "32")),
            max_texts_per_request=int(env("MAX_TEXTS_PER_REQUEST", "256")),
            max_chars_per_text=int(env("MAX_CHARS_PER_TEXT", "8000")),
            threads=int(env("TORCH_THREADS", "12")),
            batch_wait_ms=float(env("BATCH_WAIT_MS", "5")),
            matryoshka=opt_bool("MATRYOSHKA"),
            query_prompt_name=env("QUERY_PROMPT_NAME"),
            doc_prompt_name=env("DOC_PROMPT_NAME"),
        )


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1)
    input_type: Literal["document", "query"] = "document"


class EmbedResponse(BaseModel):
    vectors: list[list[float]]
    model: str
    dims: int


@dataclass
class _Job:
    texts: list[str]
    input_type: str
    future: asyncio.Future


class Batcher:
    """Coalesces queued requests of the same input_type into batches of <= batch_size texts.

    A request larger than batch_size is still encoded in one call (the encoder splits it
    internally), so a request is never torn across batches.
    """

    def __init__(self, encoder: EncoderLike, batch_size: int, wait_ms: float) -> None:
        self.encoder = encoder
        self.batch_size = batch_size
        self.wait_s = wait_ms / 1000.0
        self.queue: asyncio.Queue[_Job] = asyncio.Queue()
        self._task: asyncio.Task | None = None
        self._carry: _Job | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task

    async def submit(self, texts: list[str], input_type: str) -> np.ndarray:
        fut = asyncio.get_running_loop().create_future()
        await self.queue.put(_Job(texts, input_type, fut))
        return await fut

    async def _next_batch(self) -> list[_Job]:
        first = self._carry or await self.queue.get()
        self._carry = None
        batch, n = [first], len(first.texts)
        if self.wait_s > 0 and n < self.batch_size:
            await asyncio.sleep(self.wait_s)
        while n < self.batch_size and not self.queue.empty():
            job = self.queue.get_nowait()
            if job.input_type != first.input_type or n + len(job.texts) > self.batch_size:
                self._carry = job
                break
            batch.append(job)
            n += len(job.texts)
        return batch

    async def _run(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            batch = await self._next_batch()
            texts = [t for job in batch for t in job.texts]
            try:
                vecs = await loop.run_in_executor(
                    None, self.encoder.encode, texts, batch[0].input_type, self.batch_size
                )
            except Exception as exc:  # deliver the failure to every waiting request
                log.exception("encode failed for %d texts", len(texts))
                for job in batch:
                    if not job.future.done():
                        job.future.set_exception(exc)
                continue
            i = 0
            for job in batch:
                j = i + len(job.texts)
                if not job.future.done():
                    job.future.set_result(vecs[i:j])
                i = j


def _default_encoder_factory(s: Settings) -> EncoderLike:
    from .encoder import Encoder

    return Encoder(
        s.model_id,
        cache_dir=s.cache_dir,
        revision=s.revision,
        max_seq_length=s.max_seq_length,
        threads=s.threads,
        matryoshka=s.matryoshka,
        require_compatible=True,
        query_prompt_name=s.query_prompt_name,
        doc_prompt_name=s.doc_prompt_name,
    )


def create_app(
    settings: Settings | None = None,
    encoder_factory: Callable[[Settings], EncoderLike] = _default_encoder_factory,
) -> FastAPI:
    settings = settings or Settings.from_env()
    state: dict = {"encoder": None, "batcher": None, "error": None}

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        loop = asyncio.get_running_loop()
        try:
            enc = await loop.run_in_executor(None, encoder_factory, settings)
            # Warm-up so the first real request does not pay for lazy init.
            await loop.run_in_executor(None, lambda: enc.encode(["warm up"], "document", 1))
        except Exception as exc:
            state["error"] = f"{type(exc).__name__}: {exc}"
            log.exception("model load failed")
            raise
        state["encoder"] = enc
        batcher = Batcher(enc, settings.batch_size, settings.batch_wait_ms)
        batcher.start()
        state["batcher"] = batcher
        yield
        await batcher.stop()

    app = FastAPI(title="mapr-embedder", lifespan=lifespan)

    @app.get("/healthz")
    async def healthz():
        enc = state["encoder"]
        if enc is None:
            return JSONResponse({"status": "loading", "error": state["error"]}, status_code=503)
        return {"status": "ok", "model": enc.model_id, "dims": enc.dims}

    @app.post("/embed", response_model=EmbedResponse)
    async def embed(req: EmbedRequest):
        enc, batcher = state["encoder"], state["batcher"]
        if enc is None or batcher is None:
            raise HTTPException(503, "model not loaded")
        if len(req.texts) > settings.max_texts_per_request:
            raise HTTPException(413, f"at most {settings.max_texts_per_request} texts per request")
        texts = []
        for i, t in enumerate(req.texts):
            t = t.strip()
            if not t:
                raise HTTPException(422, f"texts[{i}] is empty")
            # Character cap only bounds tokenizer work; the model truncates at MAX_SEQ_LENGTH tokens.
            texts.append(t[: settings.max_chars_per_text])
        vecs = await batcher.submit(texts, req.input_type)
        if vecs.shape != (len(texts), enc.dims):
            raise HTTPException(500, f"encoder returned shape {vecs.shape}")
        return EmbedResponse(vectors=vecs.tolist(), model=enc.model_id, dims=enc.dims)

    return app


def app_factory() -> FastAPI:
    """Entry point: uvicorn --factory mapr_embedder.server:app_factory"""
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    return create_app()
