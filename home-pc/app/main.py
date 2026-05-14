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
# Keep this below the Node client's MAPR_AI_GENERATE_TIMEOUT_MS default (45s)
# so the sidecar returns a useful JSON error instead of letting Node abort.
OLLAMA_GENERATE_TIMEOUT_S = float(os.environ.get("OLLAMA_GENERATE_TIMEOUT_S", "40"))

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
    # Accept both the sidecar's original snake_case and the Node client's
    # documented camelCase shape.
    max_tokens: Optional[int] = None
    maxTokens: Optional[int] = None
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
        # ~2 GB bge-m3 weights load into memory.
        loop = asyncio.get_event_loop()
        embedder = await loop.run_in_executor(None, _load_embedder)
    return embedder


def _load_embedder():
    """
    Prefer the ONNX backend when available, but smoke-test the first encode
    during load. Some cached/upstream ONNX exports expose unexpected output
    names and fail only on encode; in that case fall back to PyTorch instead
    of breaking /embed after restart.
    """
    from sentence_transformers import SentenceTransformer
    log.info("loading embed model: %s", EMBED_MODEL)
    try:
        model = SentenceTransformer(EMBED_MODEL, backend="onnx", model_kwargs={"file_name": "model.onnx"})
        test_vec = model.encode(["warmup"], normalize_embeddings=True, batch_size=1)
        if len(test_vec[0]) != 1024:
            raise RuntimeError(f"unexpected embedding dimension: {len(test_vec[0])}")
        return model
    except Exception as e:
        log.warning("onnx embed load failed, falling back to pytorch: %r", e)
        model = SentenceTransformer(EMBED_MODEL)
        test_vec = model.encode(["warmup"], normalize_embeddings=True, batch_size=1)
        if len(test_vec[0]) != 1024:
            raise RuntimeError(f"unexpected embedding dimension: {len(test_vec[0])}")
        return model


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
        max_tokens = _requested_max_tokens(req)
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
            "keep_alive": "30m",
            "options": {
                "temperature": req.temperature,
                "num_predict": max_tokens,
            },
        }
        try:
            r = await ollama_client.post("/api/chat", json=ollama_body, timeout=OLLAMA_GENERATE_TIMEOUT_S)
            r.raise_for_status()
        except httpx.TimeoutException as e:
            took_ms = int((time.monotonic() - t0) * 1000)
            log.warning(
                "generate timeout task=%s model=%s took_ms=%s timeout_s=%s max_tokens=%s error=%s",
                req.task, OLLAMA_MODEL, took_ms, OLLAMA_GENERATE_TIMEOUT_S, max_tokens, repr(e),
            )
            raise HTTPException(
                status_code=504,
                detail={
                    "error": "ollama_timeout",
                    "model": OLLAMA_MODEL,
                    "task": req.task,
                    "took_ms": took_ms,
                    "timeout_s": OLLAMA_GENERATE_TIMEOUT_S,
                },
            )
        except httpx.HTTPError as e:
            took_ms = int((time.monotonic() - t0) * 1000)
            log.warning("generate http_error task=%s model=%s took_ms=%s error=%s", req.task, OLLAMA_MODEL, took_ms, repr(e))
            raise HTTPException(status_code=502, detail={"error": "ollama_http_error", "message": str(e), "model": OLLAMA_MODEL, "task": req.task, "took_ms": took_ms})
        data = r.json()
        content = (data.get("message") or {}).get("content") or "{}"
        try:
            output = json.loads(content)
        except json.JSONDecodeError as e:
            took_ms = int((time.monotonic() - t0) * 1000)
            log.warning("generate invalid_json task=%s model=%s took_ms=%s raw=%r", req.task, OLLAMA_MODEL, took_ms, content[:500])
            raise HTTPException(status_code=502, detail={"error": "invalid_model_json", "message": str(e), "raw": content[:500], "model": OLLAMA_MODEL, "task": req.task, "took_ms": took_ms})
        output = _coerce_output_for_task(req, output)
        took_ms = int((time.monotonic() - t0) * 1000)
        log.info(
            "generate ok task=%s model=%s took_ms=%s tokens_in=%s tokens_out=%s max_tokens=%s",
            req.task, OLLAMA_MODEL, took_ms, data.get("prompt_eval_count"), data.get("eval_count"), max_tokens,
        )
        return GenerateResponse(
            output=output,
            model=OLLAMA_MODEL,
            tokens_in=data.get("prompt_eval_count"),
            tokens_out=data.get("eval_count"),
            took_ms=took_ms,
        )


def _requested_max_tokens(req: GenerateRequest) -> int:
    value = req.maxTokens if req.maxTokens is not None else req.max_tokens
    try:
        return max(1, min(int(value or 512), 2048))
    except (TypeError, ValueError):
        return 512


def _qa_citations(req: GenerateRequest) -> List[Dict[str, Any]]:
    citations = req.input.get("citations") or req.input.get("sources") or []
    return citations if isinstance(citations, list) else []


def _qa_question(req: GenerateRequest) -> str:
    return str(req.input.get("question") or req.input.get("message") or req.input.get("query") or "").strip()


def _coerce_output_for_task(req: GenerateRequest, output: Any) -> Any:
    if req.task.lower() != "qa":
        return output
    if not isinstance(output, dict):
        output = {}
    answer = output.get("answer")
    if not isinstance(answer, str):
        answer = ""
    citations_out = []
    for item in output.get("citations") or []:
        if not isinstance(item, dict):
            continue
        try:
            index = int(item.get("index"))
        except (TypeError, ValueError):
            continue
        article_id = item.get("articleId") or item.get("article_id") or item.get("id")
        if article_id is None:
            source_cites = _qa_citations(req)
            if 0 <= index < len(source_cites) and isinstance(source_cites[index], dict):
                article_id = source_cites[index].get("articleId") or source_cites[index].get("id")
        if article_id is None:
            continue
        coerced = {"index": index, "articleId": str(article_id)}
        if isinstance(item.get("quote"), str) and item["quote"].strip():
            coerced["quote"] = item["quote"].strip()
        citations_out.append(coerced)
    return {"answer": answer, "citations": citations_out}


def _system_prompt_for(req: GenerateRequest) -> str:
    base = (
        "You are Mapr's analyst assistant. You return JSON only — no prose "
        "outside the JSON object. The structure must match the schema below."
    )
    if req.task.lower() == "qa":
        qa = (
            "For task qa, return exactly this shape: "
            "{\"answer\": string, \"citations\": [{\"index\": number, \"articleId\": string, \"quote\"?: string}]}. "
            "Use only provided citations for factual claims. If citations are provided, cite the relevant article indexes and articleIds. "
            "Greetings and small talk are not factual claims and do not require citations. "
            "If no citations are provided and the user sends a conversational message, set answer to a brief natural conversational response and use an empty citations array. "
            "The answer field must always be a non-empty string."
        )
        if req.schema:
            return f"{base}\n{qa}\n\nSCHEMA:\n{json.dumps(req.schema, separators=(',', ':'))}"
        return f"{base}\n{qa}"
    if req.schema:
        return f"{base}\n\nSCHEMA:\n{json.dumps(req.schema, separators=(',', ':'))}"
    return base


@app.on_event("shutdown")
async def _shutdown() -> None:
    await ollama_client.aclose()
