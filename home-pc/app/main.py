"""
Mapr AI worker — FastAPI gateway for the home-PC AI service.

Endpoints:
  POST /embed     — sentence embeddings via BAAI/bge-m3 (1024-dim, multilingual)
  POST /ner       — entity extraction via urchade/gliner_multi-v2.1
  POST /generate  — JSON-mode text generation via private llama.cpp server
                    serving Qwen 2.5 3B Instruct Q4_K_M GGUF
  GET  /healthz   — liveness + resource snapshot

Auth: every public endpoint must carry `x-mapr-token: $MAPR_AI_BEARER`.
This deployment relies on Cloudflare Tunnel for ingress and the app bearer
as the auth layer for gateway endpoints.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

import httpx
import psycopg
from psycopg.rows import dict_row
from fastapi import Body, Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(name)s %(message)s")
log = logging.getLogger("mapr.ai")

# ── Config ────────────────────────────────────────────────────────────
BEARER = os.environ.get("MAPR_AI_BEARER", "")
LLAMA_CPP_BASE_URL = os.environ.get("LLAMA_CPP_BASE_URL", os.environ.get("OLLAMA_BASE_URL", "http://llama-cpp:8080"))
LLM_MODEL = os.environ.get("LLM_MODEL", os.environ.get("OLLAMA_MODEL", "qwen2.5-3b-instruct-q4_k_m.gguf"))
EMBED_MODEL = os.environ.get("EMBED_MODEL", "BAAI/bge-m3")
NER_MODEL = os.environ.get("NER_MODEL", "urchade/gliner_multi-v2.1")
MAX_CONCURRENT_LLM = int(os.environ.get("MAX_CONCURRENT_LLM", "1"))
MAX_CONCURRENT_EMBED = int(os.environ.get("MAX_CONCURRENT_EMBED", "2"))
# Keep this below the Node client's MAPR_AI_GENERATE_TIMEOUT_MS default (45s)
# so the sidecar returns a useful JSON error instead of letting Node abort.
LLM_GENERATE_TIMEOUT_S = float(os.environ.get("LLM_GENERATE_TIMEOUT_S", os.environ.get("OLLAMA_GENERATE_TIMEOUT_S", "40")))
DATABASE_URL = os.environ.get("DATABASE_URL", "")
QA_QUEUE_MAX_DEPTH = int(os.environ.get("QA_QUEUE_MAX_DEPTH", "3"))
QA_QUEUE_WAIT_TIMEOUT_S = float(os.environ.get("QA_QUEUE_WAIT_TIMEOUT_S", "8"))
QA_TOP_K = int(os.environ.get("QA_TOP_K", "5"))
QA_LEXICAL_K = int(os.environ.get("QA_LEXICAL_K", "5"))
QA_MIN_SIMILARITY = float(os.environ.get("QA_MIN_SIMILARITY", "0.30"))
QA_MAX_OUTPUT_TOKENS = int(os.environ.get("QA_MAX_OUTPUT_TOKENS", "500"))
QA_HARD_MAX_OUTPUT_TOKENS = int(os.environ.get("QA_HARD_MAX_OUTPUT_TOKENS", "700"))

# Observability counters for /healthz and logs. The semaphore is the bounded
# queue/backpressure mechanism for low-budget CPU generation: one active LLM
# decode, at most QA_QUEUE_MAX_DEPTH requests waiting, then structured AI_BUSY.
qa_waiting = 0
qa_active_generations = 0
qa_timeout_count = 0
qa_last_success: Optional[str] = None
qa_last_error: Optional[Dict[str, Any]] = None

# Concurrency gates. The LLM is single-slot because Qwen 2.5 3B Q4 on CPU
# does not benefit from concurrent decoding (KV cache + thread pinning
# already use all the cores). Embeddings batch well and can run in parallel.
llm_semaphore = asyncio.Semaphore(MAX_CONCURRENT_LLM)
embed_semaphore = asyncio.Semaphore(MAX_CONCURRENT_EMBED)

embedder = None  # lazy-loaded sentence-transformer
ner_model = None  # lazy-loaded GLiNER model
llm_client = httpx.AsyncClient(base_url=LLAMA_CPP_BASE_URL, timeout=120.0)

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
        "llm_model": LLM_MODEL,
        "max_concurrent_llm": MAX_CONCURRENT_LLM,
        "max_concurrent_embed": MAX_CONCURRENT_EMBED,
        "queue_depth": qa_waiting,
        "active_generation_count": qa_active_generations,
        "queue_max_depth": QA_QUEUE_MAX_DEPTH,
        "provider": "local",
        "model": LLM_MODEL,
        "timeout_count": qa_timeout_count,
        "last_successful_generation": qa_last_success,
        "last_error": qa_last_error,
    }


@app.get("/readyz", dependencies=[Depends(require_bearer)])
async def readyz():
    checks: Dict[str, Any] = {"database": False, "llama_cpp": False}
    if DATABASE_URL:
        try:
            with psycopg.connect(DATABASE_URL, connect_timeout=3) as conn:
                with conn.cursor() as cur:
                    cur.execute("select 1")
                    checks["database"] = True
        except Exception as e:
            checks["database_error"] = str(e)[:160]
    else:
        checks["database_error"] = "DATABASE_URL not configured"
    try:
        r = await llm_client.get("/health", timeout=3.0)
        checks["llama_cpp"] = r.status_code == 200
    except Exception as e:
        checks["llama_cpp_error"] = repr(e)[:160]
    ok = bool(checks["database"] and checks["llama_cpp"])
    if not ok:
        raise HTTPException(status_code=503, detail={"code": "AI_NOT_READY", "checks": checks})
    return {"ok": True, "checks": checks, "model": LLM_MODEL}


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


async def _generate_locked(req: GenerateRequest) -> GenerateResponse:
    """
    Run one llama.cpp JSON generation. The caller must already hold
    llm_semaphore; keeping semaphore ownership outside this function lets
    /v1/qa measure queue wait time without deadlocking on a nested acquire.
    """
    t0 = time.monotonic()
    max_tokens = _requested_max_tokens(req)
    sys_prompt = _system_prompt_for(req)
    user_msg = json.dumps({"task": req.task, "input": req.input})
    llm_body = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_msg},
        ],
        "response_format": {"type": "json_object"},
        "stream": False,
        "temperature": req.temperature,
        "max_tokens": max_tokens,
    }
    try:
        r = await llm_client.post("/v1/chat/completions", json=llm_body, timeout=LLM_GENERATE_TIMEOUT_S)
        r.raise_for_status()
    except httpx.TimeoutException as e:
        took_ms = int((time.monotonic() - t0) * 1000)
        log.warning(
            "generate timeout task=%s model=%s took_ms=%s timeout_s=%s max_tokens=%s error=%s",
            req.task, LLM_MODEL, took_ms, LLM_GENERATE_TIMEOUT_S, max_tokens, repr(e),
        )
        raise HTTPException(
            status_code=504,
            detail={
                "error": "llama_cpp_timeout",
                "code": "AI_TIMEOUT",
                "model": LLM_MODEL,
                "task": req.task,
                "took_ms": took_ms,
                "timeout_s": LLM_GENERATE_TIMEOUT_S,
            },
        )
    except httpx.HTTPError as e:
        took_ms = int((time.monotonic() - t0) * 1000)
        log.warning("generate http_error task=%s model=%s took_ms=%s error=%s", req.task, LLM_MODEL, took_ms, repr(e))
        raise HTTPException(status_code=502, detail={"error": "llama_cpp_http_error", "code": "AI_UPSTREAM_ERROR", "message": str(e), "model": LLM_MODEL, "task": req.task, "took_ms": took_ms})
    data = r.json()
    content = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "{}")
    try:
        output = json.loads(content)
    except json.JSONDecodeError as e:
        took_ms = int((time.monotonic() - t0) * 1000)
        log.warning("generate invalid_json task=%s model=%s took_ms=%s raw=%r", req.task, LLM_MODEL, took_ms, content[:500])
        raise HTTPException(status_code=502, detail={"error": "invalid_model_json", "code": "AI_UPSTREAM_ERROR", "message": str(e), "raw": content[:500], "model": LLM_MODEL, "task": req.task, "took_ms": took_ms})
    output = _coerce_output_for_task(req, output)
    took_ms = int((time.monotonic() - t0) * 1000)
    log.info(
        "generate ok task=%s model=%s took_ms=%s tokens_in=%s tokens_out=%s max_tokens=%s",
        req.task, LLM_MODEL, took_ms, (data.get("usage") or {}).get("prompt_tokens"), (data.get("usage") or {}).get("completion_tokens"), max_tokens,
    )
    return GenerateResponse(
        output=output,
        model=LLM_MODEL,
        tokens_in=(data.get("usage") or {}).get("prompt_tokens"),
        tokens_out=(data.get("usage") or {}).get("completion_tokens"),
        took_ms=took_ms,
    )


@app.post("/generate", response_model=GenerateResponse, dependencies=[Depends(require_bearer)])
async def generate(req: GenerateRequest = Body(...)) -> GenerateResponse:
    """
    Constrained JSON generation. Builds an OpenAI-compatible chat request and asks
    the private llama.cpp server to format the response as JSON.
    For strict schema adherence, the JSON schema is embedded in the system
    prompt so the model knows exactly which keys to emit.
    """
    async with llm_semaphore:
        return await _generate_locked(req)


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


class QaGatewayRequest(BaseModel):
    requestId: Optional[str] = None
    conversationId: Optional[str] = None
    question: str = Field(..., min_length=1, max_length=4000)
    priorMessages: List[Dict[str, Any]] = Field(default_factory=list)
    filters: Dict[str, Any] = Field(default_factory=dict)
    maxTokens: Optional[int] = None


class QaGatewayResponse(BaseModel):
    answer: str
    citations: List[Dict[str, Any]]
    modelUsed: str
    provider: str = "local"
    tokensIn: Optional[int] = None
    tokensOut: Optional[int] = None
    took_ms: int
    queueWaitMs: int
    requestId: str
    conversationId: Optional[str] = None


STOPWORDS = {
    "about", "after", "again", "against", "anything", "before", "between", "brief", "briefing",
    "could", "current", "does", "from", "happen", "happened", "have", "into", "latest",
    "more", "news", "recent", "report", "reports", "show", "source", "sources", "that",
    "their", "the", "there", "these", "this", "today", "updates", "what", "when", "where",
    "which", "with", "would",
}


def _clean_text(raw: Any) -> str:
    return re.sub(r"\\s+", " ", re.sub(r"<[^>]*>", " ", str(raw or ""))).strip()


def _excerpt(payload_raw: Any, title: Any) -> str:
    payload = {}
    try:
        payload = json.loads(payload_raw or "{}") if isinstance(payload_raw, str) else (payload_raw or {})
    except Exception:
        payload = {}
    for key in ("summary", "description", "content", "body", "text"):
        val = _clean_text(payload.get(key))
        if val:
            return val[:360]
    return _clean_text(title)[:360]


def _search_terms(question: str) -> List[str]:
    out, seen = [], set()
    for term in re.findall(r"[\\w]{3,}", question.lower(), flags=re.UNICODE):
        if term in STOPWORDS or term in seen:
            continue
        seen.add(term)
        out.append(term)
        if len(out) >= 8:
            break
    return out


def _vector_literal(vec: List[float]) -> str:
    return "[" + ",".join(f"{float(v):.6f}" for v in vec) + "]"


def _row_to_citation(row: Dict[str, Any], mode: str, index: int) -> Dict[str, Any]:
    return {
        "index": index,
        "articleId": str(row.get("id")),
        "eventId": row.get("event_id"),
        "title": row.get("title") or "",
        "source": row.get("source") or "",
        "url": row.get("url"),
        "publishedAt": row.get("publishedAt").isoformat() if hasattr(row.get("publishedAt"), "isoformat") else row.get("publishedAt"),
        "eventTitle": row.get("event_title"),
        "eventCountry": row.get("event_country"),
        "eventCategory": row.get("event_category"),
        "retrievalMode": mode,
        "similarity": float(row["similarity"]) if row.get("similarity") is not None else None,
        "lexicalScore": float(row["lexical_score"]) if row.get("lexical_score") is not None else None,
        "excerpt": _excerpt(row.get("payload"), row.get("title")),
    }


def _db_retrieve_sync(question: str, query_vec: Optional[List[float]], filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL not configured")
    region = (filters or {}).get("region")
    time_window = float((filters or {}).get("timeWindowHours") or 168)
    cutoff_sql = "NULLIF(a.\"publishedAt\", '')::timestamptz >= now() - (%s || ' hours')::interval"
    base_select = """
      SELECT a.id, a.title, a.url, a.source, a.\"publishedAt\", a.payload, a.embedding,
             ea.\"eventId\" AS event_id, e.title AS event_title,
             e.\"primaryCountry\" AS event_country, e.category AS event_category
      FROM articles a
      LEFT JOIN event_articles ea ON ea.\"articleId\" = a.id
      LEFT JOIN events e ON e.id = ea.\"eventId\"
    """
    out: List[Dict[str, Any]] = []
    with psycopg.connect(DATABASE_URL, connect_timeout=5) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            if query_vec:
                params: List[Any] = [_vector_literal(query_vec), time_window]
                conditions = ["a.embedding IS NOT NULL", cutoff_sql]
                if region:
                    conditions.append('a."isoA2" = %s')
                    params.append(str(region).upper())
                sql = f"""
                  SELECT *, 1 - (embedding <=> %s::vector) AS similarity, NULL::float AS lexical_score
                  FROM ({base_select} WHERE {' AND '.join(conditions)}) s
                  ORDER BY embedding <=> %s::vector
                  LIMIT %s
                """
                # duplicate vector for ORDER BY because psycopg positional placeholders are sequential.
                params2 = [_vector_literal(query_vec)] + params[1:] + [_vector_literal(query_vec), max(1, min(QA_TOP_K, 16))]
                cur.execute(sql, params2)
                for row in cur.fetchall():
                    if row.get("similarity") is None or float(row["similarity"]) >= QA_MIN_SIMILARITY:
                        out.append(_row_to_citation(row, "semantic", len(out) + 1))
            terms = _search_terms(question)
            if terms and len(out) < QA_TOP_K:
                params = [time_window]
                conditions = [cutoff_sql]
                if region:
                    conditions.append('a."isoA2" = %s')
                    params.append(str(region).upper())
                likes = []
                for term in terms:
                    like = f"%{term}%"
                    likes.append("(LOWER(a.title) LIKE %s OR LOWER(COALESCE(a.source,'')) LIKE %s OR LOWER(COALESCE(a.payload,'')) LIKE %s OR LOWER(COALESCE(e.title,'')) LIKE %s OR LOWER(COALESCE(e.\"primaryCountry\",'')) LIKE %s OR LOWER(COALESCE(e.category,'')) LIKE %s)")
                    params.extend([like, like, like, like, like, like])
                conditions.append("(" + " OR ".join(likes) + ")")
                sql = f"""
                  SELECT *, 1::float AS lexical_score, NULL::float AS similarity
                  FROM ({base_select} WHERE {' AND '.join(conditions)}) s
                  ORDER BY s.\"publishedAt\" DESC NULLS LAST
                  LIMIT %s
                """
                params.append(max(1, min(QA_LEXICAL_K, 16)))
                cur.execute(sql, params)
                seen = {c["articleId"] for c in out}
                for row in cur.fetchall():
                    if str(row.get("id")) not in seen and len(out) < QA_TOP_K:
                        out.append(_row_to_citation(row, "lexical", len(out) + 1))
    return out[:QA_TOP_K]


async def _retrieve_for_qa(question: str, prior: List[Dict[str, Any]], filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    last_assistant = next((m for m in reversed(prior or []) if m.get("role") == "assistant"), None)
    composite = f"Previous answer: {str(last_assistant.get('content', ''))[:400]}\\n\\nQuestion: {question}" if last_assistant else question
    vec = None
    try:
        model = await get_embedder()
        loop = asyncio.get_event_loop()
        vectors = await loop.run_in_executor(None, lambda: model.encode([composite], normalize_embeddings=True, batch_size=1).tolist())
        vec = vectors[0] if vectors else None
    except Exception as e:
        log.warning("qa embed failed; lexical fallback request=%s error=%r", hashlib.sha1(question.encode()).hexdigest()[:10], e)
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: _db_retrieve_sync(composite, vec, filters or {}))


def _qa_input(question: str, prior: List[Dict[str, Any]], citations: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "question": question[:4000],
        "prior_messages": [{"role": (m.get("role") if m.get("role") == "assistant" else "user"), "content": str(m.get("content", ""))[:500]} for m in (prior or [])[-4:]],
        "citations": [{k: c.get(k) for k in ("index", "articleId", "title", "source", "publishedAt", "eventTitle", "eventCountry", "eventCategory", "retrievalMode", "excerpt")} for c in citations[:QA_TOP_K]],
        "current_date": time.strftime("%Y-%m-%d"),
        "instructions": "Answer using only provided Mapr corpus citations for factual claims. If no citations cover the question, say what evidence is missing. Greetings/small talk may be answered naturally. Keep output concise and cite with [1], [2] when citations are used.",
    }


def _is_conversational_only(question: str) -> bool:
    """
    Route obvious greetings/small talk to the same model with a compact prompt
    instead of doing RAG over unrelated corpus items. This does not return a
    scripted answer; it only avoids wasting retrieval/context on non-factual
    requests.
    """
    q = re.sub(r"[^a-z0-9\s'?!]", " ", question.lower()).strip()
    q = re.sub(r"\s+", " ", q)
    if not q or len(q) > 80:
        return False
    patterns = (
        r"^(hi|hello|hey|yo|sup|howdy)[!?.\s]*$",
        r"^(hi|hello|hey|yo|sup|howdy)\s+(there|mapr|assistant|buddy)[!?.\s]*$",
        r"^good\s+(morning|afternoon|evening)[!?.\s]*$",
        r"^how\s+are\s+you[!?.\s]*$",
        r"^thanks?(\s+you)?[!?.\s]*$",
    )
    return any(re.match(p, q) for p in patterns)


async def _generate_qa(req: QaGatewayRequest, citations: List[Dict[str, Any]]) -> GenerateResponse:
    schema = {"type": "object", "required": ["answer", "citations"], "properties": {"answer": {"type": "string"}, "citations": {"type": "array", "items": {"type": "object"}}}}
    gen_req = GenerateRequest(task="qa", input=_qa_input(req.question, req.priorMessages, citations), schema=schema, maxTokens=min(int(req.maxTokens or QA_MAX_OUTPUT_TOKENS), QA_HARD_MAX_OUTPUT_TOKENS), temperature=0.2)
    return await _generate_locked(gen_req)


@app.post("/v1/qa", response_model=QaGatewayResponse, dependencies=[Depends(require_bearer)])
async def v1_qa(req: QaGatewayRequest, request: Request) -> QaGatewayResponse:
    global qa_waiting, qa_active_generations, qa_timeout_count, qa_last_success, qa_last_error
    request_id = req.requestId or hashlib.sha1(f"{time.time()}:{req.question}".encode()).hexdigest()[:16]
    if qa_waiting >= QA_QUEUE_MAX_DEPTH and llm_semaphore.locked():
        qa_last_error = {"code": "AI_BUSY", "request_id": request_id, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        raise HTTPException(status_code=503, detail={"code": "AI_BUSY", "request_id": request_id, "queue_depth": qa_waiting, "active_generation_count": qa_active_generations})
    t0 = time.monotonic()
    citations = [] if _is_conversational_only(req.question) else await _retrieve_for_qa(req.question, req.priorMessages, req.filters)
    qa_waiting += 1
    queue_started = time.monotonic()
    acquired = False
    try:
        try:
            await asyncio.wait_for(llm_semaphore.acquire(), timeout=QA_QUEUE_WAIT_TIMEOUT_S)
            acquired = True
        except asyncio.TimeoutError:
            qa_timeout_count += 1
            qa_last_error = {"code": "AI_BUSY", "request_id": request_id, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
            raise HTTPException(status_code=503, detail={"code": "AI_BUSY", "request_id": request_id, "queue_wait_ms": int((time.monotonic() - queue_started) * 1000)})
        finally:
            qa_waiting = max(0, qa_waiting - 1)
        qa_active_generations += 1
        queue_wait_ms = int((time.monotonic() - queue_started) * 1000)
        gen = await _generate_qa(req, citations)
        supported = {c["articleId"]: c for c in citations}
        out_cites = []
        for c in (gen.output or {}).get("citations") or []:
            aid = str(c.get("articleId") or c.get("article_id") or "")
            if aid in supported:
                meta = dict(supported[aid])
                if isinstance(c.get("quote"), str) and c["quote"].strip():
                    meta["quote"] = c["quote"].strip()[:240]
                out_cites.append(meta)
        answer = str((gen.output or {}).get("answer") or "").strip()
        if not answer:
            raise HTTPException(status_code=502, detail={"code": "AI_UPSTREAM_ERROR", "request_id": request_id, "message": "model returned empty answer"})
        if citations and not out_cites:
            raise HTTPException(status_code=502, detail={"code": "AI_UPSTREAM_ERROR", "request_id": request_id, "message": "model returned no supported citations"})
        took_ms = int((time.monotonic() - t0) * 1000)
        qa_last_success = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        log.info("qa ok request_id=%s conversation_id=%s queue_depth=%s queue_wait_ms=%s active_generation_count=%s provider=local model=%s tokens_in=%s tokens_out=%s took_ms=%s citations=%s", request_id, req.conversationId, qa_waiting, queue_wait_ms, qa_active_generations, LLM_MODEL, gen.tokens_in, gen.tokens_out, took_ms, len(out_cites))
        return QaGatewayResponse(answer=answer, citations=out_cites, modelUsed=gen.model, tokensIn=gen.tokens_in, tokensOut=gen.tokens_out, took_ms=took_ms, queueWaitMs=queue_wait_ms, requestId=request_id, conversationId=req.conversationId)
    except HTTPException as e:
        qa_last_error = {"code": getattr(e, "detail", {}).get("code") if isinstance(e.detail, dict) else "AI_UPSTREAM_ERROR", "request_id": request_id, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        log.warning("qa error request_id=%s conversation_id=%s detail=%s", request_id, req.conversationId, e.detail)
        raise
    finally:
        if acquired:
            qa_active_generations = max(0, qa_active_generations - 1)
            llm_semaphore.release()


@app.on_event("shutdown")
async def _shutdown() -> None:
    await llm_client.aclose()
