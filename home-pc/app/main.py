"""
Mapr AI worker — FastAPI service for the home-PC sidecar.

Endpoints:
  POST /embed     — sentence embeddings via BAAI/bge-m3 (1024-dim, multilingual)
  POST /ner       — entity extraction via urchade/gliner_multi-v2.1
  POST /generate  — JSON-mode text generation, proxied to local Ollama
                    serving Qwen 2.5 3B Instruct (Q4_K_M)
  GET  /healthz   — liveness + resource snapshot

Auth: every public endpoint must carry `x-mapr-token: $MAPR_AI_BEARER`.
This deployment relies on Cloudflare Tunnel for ingress and the app bearer
as the public-facing auth layer.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

import httpx
from fastapi import Body, Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(name)s %(message)s")
log = logging.getLogger("mapr.ai")

# ── Config ────────────────────────────────────────────────────────────
BEARER = os.environ.get("MAPR_AI_BEARER", "")
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://ollama:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:3b-instruct-q4_K_M")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "BAAI/bge-m3")
NER_MODEL = os.environ.get("NER_MODEL", "urchade/gliner_multi-v2.1")
MAX_CONCURRENT_LLM = int(os.environ.get("MAX_CONCURRENT_LLM", "1"))
MAX_CONCURRENT_EMBED = int(os.environ.get("MAX_CONCURRENT_EMBED", "2"))

# Concurrency gates. The LLM is single-slot because Qwen 2.5 3B Q4 on CPU
# does not benefit from concurrent decoding (KV cache + thread pinning
# already use all the cores). Embeddings batch well and can run in parallel.
llm_semaphore = asyncio.Semaphore(MAX_CONCURRENT_LLM)
embed_semaphore = asyncio.Semaphore(MAX_CONCURRENT_EMBED)

embedder = None  # lazy-loaded sentence-transformer
ner_model = None  # lazy-loaded GLiNER model
ollama_client = httpx.AsyncClient(base_url=OLLAMA_BASE_URL, timeout=120.0)

app = FastAPI(title="mapr-ai", version="0.1.0")


# ── Auth dependency ──────────────────────────────────────────────────
def require_bearer(request: Request) -> None:
    if not BEARER:
        # Auth disabled when the env var is empty (dev convenience only).
        return
    token = request.headers.get("x-mapr-token") or ""
    if token != BEARER:
        raise HTTPException(status_code=401, detail="invalid bearer")


# ── Pydantic schemas ────────────────────────────────────────────────
class EmbedRequest(BaseModel):
    inputs: List[str] = Field(..., min_length=1, max_length=512)
    normalize: bool = True


class EmbedResponse(BaseModel):
    vectors: List[List[float]]
    model: str
    took_ms: int


class NerRequest(BaseModel):
    text: str
    lang: Optional[str] = "auto"
    labels: Optional[List[str]] = None


class NerResponse(BaseModel):
    people: List[Dict[str, Any]]
    organizations: List[Dict[str, Any]]
    locations: List[Dict[str, Any]]
    model: str
    took_ms: int


class GenerateRequest(BaseModel):
    task: str
    input: Dict[str, Any]
    schema: Optional[Dict[str, Any]] = None
    max_tokens: int = 512
    temperature: float = 0.3


class GenerateResponse(BaseModel):
    output: Any
    model: str
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    took_ms: int


# ── Lazy loaders ──────────────────────────────────────────────────────
async def get_embedder():
    global embedder
    if embedder is None:
        # Done in a thread so the FastAPI loop isn't blocked while the
        # 570 MB ONNX model loads.
        loop = asyncio.get_event_loop()
        embedder = await loop.run_in_executor(None, _load_embedder)
    return embedder


def _load_embedder():
    from sentence_transformers import SentenceTransformer
    log.info("loading embed model: %s", EMBED_MODEL)
    return SentenceTransformer(EMBED_MODEL, backend="onnx", model_kwargs={"file_name": "model.onnx"})


async def get_ner():
    global ner_model
    if ner_model is None:
        loop = asyncio.get_event_loop()
        ner_model = await loop.run_in_executor(None, _load_ner)
    return ner_model


def _load_ner():
    from gliner import GLiNER
    log.info("loading NER model: %s", NER_MODEL)
    return GLiNER.from_pretrained(NER_MODEL)


# ── Routes ────────────────────────────────────────────────────────────
@app.get("/healthz", dependencies=[Depends(require_bearer)])
async def healthz():
    return {
        "ok": True,
        "embed_loaded": embedder is not None,
        "ner_loaded": ner_model is not None,
        "ollama_model": OLLAMA_MODEL,
        "max_concurrent_llm": MAX_CONCURRENT_LLM,
        "max_concurrent_embed": MAX_CONCURRENT_EMBED,
    }


@app.post("/embed", response_model=EmbedResponse, dependencies=[Depends(require_bearer)])
async def embed(req: EmbedRequest = Body(...)) -> EmbedResponse:
    async with embed_semaphore:
        t0 = time.monotonic()
        model = await get_embedder()
        loop = asyncio.get_event_loop()
        vectors = await loop.run_in_executor(
            None,
            lambda: model.encode(req.inputs, normalize_embeddings=req.normalize, batch_size=32).tolist(),
        )
        return EmbedResponse(vectors=vectors, model=EMBED_MODEL, took_ms=int((time.monotonic() - t0) * 1000))


@app.post("/ner", response_model=NerResponse, dependencies=[Depends(require_bearer)])
async def ner(req: NerRequest = Body(...)) -> NerResponse:
    async with embed_semaphore:
        t0 = time.monotonic()
        model = await get_ner()
        labels = req.labels or ["person", "organization", "location"]
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: model.predict_entities(req.text, labels, threshold=0.4))
        people, orgs, locs = [], [], []
        for ent in result:
            entry = {"name": ent.get("text"), "span": [ent.get("start"), ent.get("end")], "score": ent.get("score")}
            label = (ent.get("label") or "").lower()
            if label == "person":
                people.append(entry)
            elif label == "organization":
                orgs.append(entry)
            elif label == "location":
                locs.append(entry)
        return NerResponse(
            people=people,
            organizations=orgs,
            locations=locs,
            model=NER_MODEL,
            took_ms=int((time.monotonic() - t0) * 1000),
        )


@app.post("/generate", response_model=GenerateResponse, dependencies=[Depends(require_bearer)])
async def generate(req: GenerateRequest = Body(...)) -> GenerateResponse:
    """
    Constrained JSON generation. Builds an Ollama chat request and asks
    Ollama to format the response as JSON (Ollama's `format: json` mode).
    For strict schema adherence, the JSON schema is embedded in the system
    prompt so the model knows exactly which keys to emit.
    """
    async with llm_semaphore:
        t0 = time.monotonic()
        sys_prompt = _system_prompt_for(req)
        user_msg = json.dumps({"task": req.task, "input": req.input})
        ollama_body = {
            "model": OLLAMA_MODEL,
            "messages": [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": user_msg},
            ],
            "format": "json",
            "stream": False,
            "options": {
                "temperature": req.temperature,
                "num_predict": req.max_tokens,
            },
        }
        try:
            r = await ollama_client.post("/api/chat", json=ollama_body)
            r.raise_for_status()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"ollama: {e}")
        data = r.json()
        content = (data.get("message") or {}).get("content") or "{}"
        try:
            output = json.loads(content)
        except json.JSONDecodeError:
            output = {"_raw": content}
        return GenerateResponse(
            output=output,
            model=OLLAMA_MODEL,
            tokens_in=data.get("prompt_eval_count"),
            tokens_out=data.get("eval_count"),
            took_ms=int((time.monotonic() - t0) * 1000),
        )


def _system_prompt_for(req: GenerateRequest) -> str:
    base = (
        "You are Mapr's analyst assistant. You return JSON only — no prose "
        "outside the JSON object. The structure must match the schema below."
    )
    if req.schema:
        return f"{base}\n\nSCHEMA:\n{json.dumps(req.schema, separators=(',', ':'))}"
    return base


@app.on_event("shutdown")
async def _shutdown() -> None:
    await ollama_client.aclose()
