# Mapr AI service — Coolify deploy

This directory deploys the separate Mapr AI service on the home PC through Coolify.

## Current architecture

- `llama-cpp`: private GGUF model server for one active Qwen2.5 GGUF at a time.
  - Default active model: `qwen2.5-3b-instruct-q4_k_m.gguf`.
  - Downloaded comparison models: `qwen2.5-1.5b-instruct-q4_k_m.gguf`, `qwen2.5-0.5b-instruct-q8_0.gguf`, `qwen2.5-0.5b-instruct-q6_k.gguf`.
  - Internal API/UI port: `8080`.
  - Public web UI: `https://llama.tors-x.dev`, protected by Traefik Basic Auth.
  - Completion/API routes are not reachable anonymously; they share the same Basic Auth guard as the UI.
- `ai-worker`: FastAPI authenticated AI Gateway.
  - `POST /v1/qa`
  - `GET /healthz`
  - `GET /readyz`
  - legacy internal endpoints: `/embed`, `/ner`, `/generate`
- `model-puller`: one-shot GGUF downloader into the persistent `llama-models` volume.
- `cloudflared`: left available for tunnel-based routing, but the Mapr backend should use internal Coolify/Docker networking, not this tunnel.

The Mapr backend must call only the authenticated AI Gateway URL:

```text
MAPR_AI_GATEWAY_URL=http://ai-worker-uvoliod0bjp0n0wdfjxd19b1:8080
MAPR_AI_GATEWAY_TOKEN=<same secret as MAPR_AI_BEARER>
```

The backend must not call `llama-cpp`, embeddings, vector retrieval, Redis, or worker internals directly.

## Required Coolify environment

Set these on the Mapr AI service:

```text
MAPR_AI_BEARER=<random shared secret>
DATABASE_URL=<Mapr Postgres URL>
LLAMA_CPP_THREADS=6
LLAMA_CPP_MODEL_FILE=qwen2.5-3b-instruct-q4_k_m.gguf
LLM_GENERATE_TIMEOUT_S=55
QA_QUEUE_MAX_DEPTH=3
QA_QUEUE_WAIT_TIMEOUT_S=8
QA_TOP_K=3
QA_LEXICAL_K=3
QA_MAX_OUTPUT_TOKENS=120
QA_HARD_MAX_OUTPUT_TOKENS=700
```

## Model selection and comparison

The AI service downloads these GGUFs into the persistent `llama-models` volume:

```text
qwen2.5-3b-instruct-q4_k_m.gguf      # current/default quality baseline
qwen2.5-1.5b-instruct-q4_k_m.gguf    # option-one likely default candidate
qwen2.5-0.5b-instruct-q8_0.gguf      # tiny, highest 0.5B quant
qwen2.5-0.5b-instruct-q6_k.gguf      # tiny, smaller/faster than Q8
```

Only one llama.cpp model is active at a time to keep memory bounded. To switch for testing in `https://llama.tors-x.dev`, set the AI service env:

```text
LLAMA_CPP_MODEL_FILE=<one filename above>
```

Then redeploy only the Mapr AI service. `model-puller` skips files already present, and both `llama-cpp` and `ai-worker` report the same active filename through `/healthz`/logs.

## Benchmarking

From the AI service network or any shell that can reach the llama.cpp server:

```bash
LLAMA_CPP_BASE_URL=http://llama-cpp:8080 \
LLAMA_MODEL=$LLAMA_CPP_MODEL_FILE \
BENCH_RUNS=3 \
python home-pc/scripts/benchmark_llama_models.py
```

Benchmark each model by setting `LLAMA_CPP_MODEL_FILE`, redeploying AI, waiting for `/readyz`, and running the script. Compare `median_output_tok_s`, `median_wall_ms`, and answer quality in the web UI.

## Networking

`ai-worker` joins both networks:

- the private Mapr AI service network, for calls to `llama-cpp`;
- the shared `coolify` network, so the Mapr app can reach the stable gateway container name after independent redeploys.

`llama-cpp` joins only the AI service network plus the shared `coolify` proxy network for the authenticated web UI route. The Mapr backend does not use the `llama-cpp` hostname.

No manual `docker network connect` should be required after redeploy.

## Public llama.cpp Web UI

`https://llama.tors-x.dev` is routed through Cloudflare Tunnel to Coolify Traefik and then to `llama-cpp:8080`.

Access is protected with Traefik Basic Auth configured on the `llama-cpp` labels. Keep the credentials out of Git and rotate them in Coolify if shared.

Because llama.cpp serves its UI and OpenAI-compatible API from the same process, the API cannot be fully separated from the UI without adding a small auth/reverse-proxy layer. Current mitigation: every public route on `llama.tors-x.dev` requires Basic Auth.

## Resource/concurrency defaults

- llama.cpp: `--parallel 1`, `--threads 6`, `--ctx-size 4096`, `--cont-batching`, memory limit 8 GB.
- AI Gateway: `MAX_CONCURRENT_LLM=1`, queue depth 3, wait timeout 8 s, memory limit 4 GB.
- RAG: top-k 3, lexical-k 3, excerpts capped for CPU latency.
- Default QA output: 120 tokens; hard cap 700.

## Smoke tests

From the Mapr app container:

```bash
node -e 'fetch(process.env.MAPR_AI_GATEWAY_URL + "/healthz", {headers:{"x-mapr-token":process.env.MAPR_AI_GATEWAY_TOKEN}}).then(r=>r.text().then(t=>console.log(r.status,t)))'
node -e 'fetch(process.env.MAPR_AI_GATEWAY_URL + "/readyz", {headers:{"x-mapr-token":process.env.MAPR_AI_GATEWAY_TOKEN}}).then(r=>r.text().then(t=>console.log(r.status,t)))'
```

Direct gateway QA smoke from the AI worker:

```bash
curl -sS -H "content-type: application/json" \
  -H "x-mapr-token: $MAPR_AI_BEARER" \
  http://localhost:8080/v1/qa \
  -d '{"requestId":"smoke","conversationId":"smoke","question":"Hello","priorMessages":[],"filters":{},"maxTokens":80}'
```

Expected success includes `provider: local`, nonzero `tokensIn`, nonzero `tokensOut`, and nonzero `took_ms`.

## Updating the model

1. Change `LLAMA_CPP_MODEL_FILE` in the AI service environment to one of the downloaded filenames.
2. Redeploy the AI service; `model-puller` downloads any missing comparison GGUFs into `llama-models` and skips existing files.
3. Confirm `llama-cpp` health, run the benchmark script, and test direct `/v1/qa` before testing the Mapr app API flow.

Avoid 7B+ models on this CPU-only host unless benchmarked. The default is Qwen2.5 3B Instruct Q4_K_M; the first speed candidate is Qwen2.5 1.5B Instruct Q4_K_M.
