# MAPR v2 embedder

This folder holds two things:

- the embedding service the ingestor calls: one FastAPI process with a sentence-transformers model on CPU;
- a bake-off that picks the model for it: `bakeoff/`, labelled data built from the legacy `data/mapr.db`.

```
POST /embed  {"texts": ["...", ...], "input_type": "document" | "query"}   # input_type optional, default "document"
          -> {"vectors": [[1024 floats], ...], "model": "<model id>", "dims": 1024}
GET  /healthz -> 200 {"status": "ok", "model": "...", "dims": 1024} once loaded, 503 while loading
```

Every vector is float32, L2-normalised and exactly 1024 long. The service refuses to start with a model that cannot give 1024 dims: it allows native 1024, or Matryoshka truncation from a larger size, and never zero-padding. Embed articles as documents, using `title + "\n" + lead` (the same text the bake-off uses). Embed search queries and watch specs with `"input_type": "query"`, so models that need an instruction (Qwen3, Harrier, EmbeddingGemma) get it. Errors: 422 for an empty or invalid text, 413 for more than `MAX_TEXTS_PER_REQUEST` texts (default 256), 503 while the model is loading.

## Serving choice: FastAPI + sentence-transformers (PyTorch CPU), not TEI

I checked text-embeddings-inference (TEI) 1.9 (`ghcr.io/huggingface/text-embeddings-inference:cpu-1.9`). It supports every candidate architecture: Qwen3 (used by Harrier and Qwen3-Embedding; CPU fixes landed in 1.7.3 and 1.8.0), XLM-RoBERTa (bge-m3) and Gemma3 (EmbeddingGemma). I still chose a small Python service, for four reasons:

1. **The bake-off measures exactly what is served.** It uses the same `mapr_embedder.encoder` code, the same prompts, truncation and normalisation, and the same image, so its quality, speed and RAM figures carry over to production.
2. **The contract needs code either way.** TEI's API is `{"inputs": ...}` and returns a bare array. We need `{"texts"}` and `{"vectors", "model", "dims"}`, a hard 1024-dim guard and Matryoshka handling, so a shim would be needed anyway.
3. **TEI's CPU path depends on the model files.** TEI on CPU uses Candle+MKL, or ONNX Runtime only when the repo ships ONNX weights (bge-m3 does; Harrier and Qwen3 do not). MKL's speed on AMD Zen 2 is a known weak spot. PyTorch's oneDNN path treats all four models the same way.
4. **Small surface.** One process, one model, a micro-batcher that merges concurrent small requests (search queries) into batches of up to 32, and 12 torch threads.

The trade-off is that TEI may be faster or use less RAM for some models. If the winning model's throughput is not enough, benchmark TEI with it (see [Alternative: TEI](#alternative-tei)). The ingestor contract would only need a shim.

## Layout

| path | what |
|---|---|
| `mapr_embedder/models.py` | candidate registry (repo ids, prompts, native dims, Matryoshka, licence) and the 1024-dim plan |
| `mapr_embedder/encoder.py` | sentence-transformers wrapper: threads, max 512 tokens, prompts, truncation, L2 normalisation |
| `mapr_embedder/server.py` | FastAPI app, micro-batcher, env config |
| `Dockerfile`, `compose.embedder.yml` | image (Python 3.12, CPU torch) and service on `127.0.0.1:8788`, `restart: unless-stopped` |
| `requirements*.txt` | pinned: `requirements.in` (top level), `requirements.txt` (full set), `requirements-torch-cpu.txt`, `requirements-dev.txt` |
| `bakeoff/build_dataset.py` | builds `dataset.jsonl`, `queries.jsonl`, `dataset_stats.json` from `data/mapr.db` (opened read-only) |
| `bakeoff/curated_groups.json` | hand-reviewed same-event groups (see Dataset) |
| `bakeoff/run.py`, `bakeoff/metrics.py` | the bake-off and its metrics |
| `tests/` | pytest: metrics, dataset builder, dims logic, service (fake encoder), bake-off scoring and resume |

## Candidates

| model id (verified) | native dims | 1024? | query prompt | licence |
|---|---|---|---|---|
| `microsoft/harrier-oss-v1-0.6b` | 1024 | yes | `web_search_query` (`Instruct: ...\nQuery: `) | MIT |
| `Qwen/Qwen3-Embedding-0.6B` | 1024 (Matryoshka) | yes | `query` (`Instruct: ...\nQuery:`) | Apache-2.0 |
| `BAAI/bge-m3` | 1024 | yes | none | MIT |
| `google/embeddinggemma-300m` | 768 (Matryoshka 768/512/256/128 only) | **no** | `query` / `document` | Gemma, gated |

EmbeddingGemma cannot reach 1024 dims without padding, so it is **incompatible** with `vector(1024)`. The bake-off still scores it at its native 768 dims, for reference only, and it can never be picked as the winner. It is a gated model: accept its licence on Hugging Face and export `HF_TOKEN`, or it shows up as "failed" in the results. Every other model still runs.

## Run the bake-off on the server

Everything goes under `/data`. The image runs as uid 10001. Run these from a checkout of this repo on the server:

```bash
cd mapr/v2/embedder
sudo install -d -o 10001 -g 10001 /data/mapr/models /data/mapr/bakeoff
docker build -t mapr-embedder:local .

# optional, only for google/embeddinggemma-300m: export HF_TOKEN=... (licence accepted on HF)
docker run --rm --name mapr-bakeoff \
  --user 10001:10001 --cpus 12 --memory 24g \
  -v /data/mapr/models:/models \
  -v /data/mapr/bakeoff:/out \
  -e HF_TOKEN \
  mapr-embedder:local \
  python -m bakeoff.run --cache-dir /models --out /out
```

- Outputs: `/data/mapr/bakeoff/results.md` (readable), `results.json` (everything, including the threshold sweep), and `runs/<model>/` (vectors, `meta.json`, logs). To keep the results with the code: `cp /data/mapr/bakeoff/results.{md,json} bakeoff/`.
- Each model runs in its own subprocesses. A **prefetch** step downloads the weights into `/models` (Hugging Face cache layout, reused by the service). A **measure** step then loads the model offline (that load is the reported load time), embeds the 1,000 articles and 170 queries at batch 32 on 12 threads, and records texts/s and peak RSS. If one model fails, is OOM-killed or times out (`--timeout`, default 3 h per step), the error is recorded and the run moves on.
- **Resumable:** run the same command again and models whose vectors exist for the same dataset and settings are skipped. Only scoring is redone (about 30 s per model). Add `--force` to re-embed, or `--models BAAI/bge-m3 Qwen/Qwen3-Embedding-0.6B` to run a subset.
- **Deterministic:** fixed seeds (13), `PYTHONHASHSEED`, deterministic torch algorithms, and no sampling anywhere in scoring.
- To run it in the background: add `-d` and follow with `docker logs -f mapr-bakeoff`.
- Thread check (optional): on 6 cores / 12 threads, 6 threads is sometimes faster for matmul-heavy work. Compare with `... python -m bakeoff.run --cache-dir /models --out /out/threads6 --threads 6`.

Without Docker, use a Python 3.12 venv on `/data`. The pins were resolved for 3.12; if Ubuntu ships a different Python, use Docker.

```bash
python3.12 -m venv /data/mapr/venvs/embedder
/data/mapr/venvs/embedder/bin/pip install -r requirements-torch-cpu.txt
/data/mapr/venvs/embedder/bin/pip install -r requirements.txt
OMP_NUM_THREADS=12 /data/mapr/venvs/embedder/bin/python -m bakeoff.run --cache-dir /data/mapr/models --out /data/mapr/bakeoff
```

### What it reports

- **Same-event vs different-event separation.** ROC AUC over article pairs, with the cosine threshold T that maximises F1 and that F1. Reported three ways: all pairs, *non-trivial* (exact-duplicate texts removed) and *non-English* (at least one non-English article). T comes from the non-trivial set.
- **Clustering.** Replays the ingestor rule in publish order: join the event with the nearest centroid if cosine ≥ T among events active within 48 h, otherwise start a new event. Scored by pairwise precision/recall/F1 and B-cubed F1, at the pair threshold and at the best threshold from a sweep over 0.30–0.95. That sweep value is the one to configure in the ingestor.
- **Retrieval.** recall@10 and MRR@10. Each query is one article's title (embedded as a query); the relevant documents are the other articles of its event. The query article and its exact duplicates are removed from the corpus for that query.
- **Cost.** Docs/s at batch 32, query throughput, load time, RSS after load, peak RSS, and token-length stats (mean, p95, share over 512 tokens).
- **Recommendation.** The highest anchored B-cubed F1 among 1024-compatible models. Scores within 0.01 are treated as a tie, broken by recall@10 and then by throughput.

"Anchored" means a pair or item only counts if at least one article comes from a multi-article event. Singleton labels come from a legacy correlator that under-merged, so singleton-vs-singleton "negatives" are unreliable. Every singleton still takes part as a distractor.

## Dataset

Build it with `python3 -m bakeoff.build_dataset`. This is deterministic and already done; the outputs are committed.

**Where the labels come from:** the legacy `events` and `event_articles` tables in `data/mapr.db` are **empty**. The only event labels are in `metadata['snapshot']`: 1,493 events with their `supportingArticles` (1,545 articles). The `articles` table holds 2,302 rows, 1,215 of which are not in the snapshot and have no label.

- Only 46 snapshot events have 2 or more articles. A spot-check of all 46 found 20 that are not one news event: 13 recurring columns or templates ("Today in Spain", word of the day, Cheltenham day 2/3/4, fantasy football, daily weather), 5 groupings of different stories (hotels vs a shoe factory, Europe vs Africa briefs, two different Diplomat op-eds, and so on), and 2 that span more than 72 h. All 20 are excluded, each with a reason, in `dataset_stats.json`.
- To get enough positives, I mined candidate groups with a TF-IDF title+lead similarity pass (cosine ≥ 0.35, ≤ 72 h apart). I then searched by hand for non-English counterparts (es/fr/pt/ro/lv/ru) of the same stories, and read and accepted every group and member by hand. Result: `curated_groups.json`, 59 groups. "Event" here means one real-world occurrence (an incident, statement, vote or meeting) plus direct reactions to it within about 72 h.
- Exact-title duplicates across legacy singletons (syndicated copies) are merged into one label (7 of them).
- Distractors: legacy singletons (English ones sampled, preferring those with a lead) plus 236 unlabelled non-English articles from `articles`.

**Stats** (`bakeoff/dataset_stats.json`):

| | |
|---|---|
| articles | 1,000 (835 gold events) |
| multi-article events | 82 (247 articles): 57×2, 7×3, 9×4, 4×5, 2×6, 2×7, 1×8, 1×22 |
| positive pairs | 507 (19 exact-duplicate text, 134 cross-lingual across 10 events) |
| retrieval queries | 170 (152 en, 11 fr/lv/ru/ro/es, 7 undetected) |
| label sources | 517 legacy singletons, 236 unlabelled distractors, 197 curated, 43 legacy events, 7 merged duplicates |
| languages (all) | en 589, es 113, und 95, ru 29, fr 29, ro 25, lv 18, zh 17, km 15, pt 11, 17 more |
| with a lead | 600 |
| published | 2018-02 to 2026-03-22, mostly 2026-03-13 to 22 |

**Noise and caveats found in the spot-check:**

- **Feed language labels are unreliable.** 23% are `unknown`. Khmer text is labelled `en`. LSM "English" items have Latvian titles. Language is re-derived from the script, then English stopwords. 95 Latin-script texts remain `und`.
- **Scraper junk.** tvnet.lv titles carry an `onclick` handler, RSS items end with "The post … appeared first on …", and some leads are only a byline or section name. These are stripped, and leads under 25 characters are dropped.
- **Evergreen items** dated 2017–2025 appear in the feeds.
- **Singletons are still under-merged.** Some distractors are really the same story as each other. Anchored metrics limit the damage, but a singleton that belongs to an anchored event still counts as a false positive.
- **Small and uneven sample.** One 22-article event (the Hormuz ultimatum) supplies 231 of the 507 positive pairs. Differences of about 0.01–0.02 between models are within noise.
- **Biased candidate mining.** Positives were mined by lexical overlap and then curated, so pairs with no shared words (most cross-lingual ones) are under-represented. Non-English retrieval rests on only 11 queries.
- **48 h window vs 72 h labels.** Some gold events span up to 72 h while the clustering window is 48 h, which caps clustering recall for every model equally.

## Start the service with the winning model

```bash
cd mapr/v2/embedder
sudo install -d -o 10001 -g 10001 /data/mapr/models     # already done if the bake-off ran
echo 'EMBED_MODEL_ID=<winner from results.md>' > .env      # no secrets in this file
docker compose -f compose.embedder.yml up -d --build
curl -s 127.0.0.1:8788/healthz
curl -s 127.0.0.1:8788/embed -H 'content-type: application/json' \
  -d '{"texts":["Cyclone Narelle hits far north Queensland"]}' | head -c 120; echo
```

- It listens on `127.0.0.1:8788` only. Containers in the `mapr` compose project (`../deploy/stbrn-studios/compose.yml`) can reach it as `http://embedder:8788`.
- The first start downloads the weights unless the bake-off already cached them, so the health check allows 10 minutes. After that, set `EMBED_HF_OFFLINE=1` in `.env` so restarts never call the Hub. Also pin `EMBED_MODEL_REVISION=<commit sha>` (from `/data/mapr/models/models--<org>--<name>/refs/main`).
- Settings (environment variables): `MODEL_ID`, `MODEL_REVISION`, `MAX_SEQ_LENGTH=512`, `BATCH_SIZE=32`, `MAX_TEXTS_PER_REQUEST=256`, `MAX_CHARS_PER_TEXT=8000`, `TORCH_THREADS=12` (`EMBED_THREADS` in compose), `BATCH_WAIT_MS=5`, `MATRYOSHKA` (only for models not in the registry), `QUERY_PROMPT_NAME` / `DOC_PROMPT_NAME` (override the registry prompts), `LOG_LEVEL`. The container memory limit is 8 GB; a 0.6B fp32 model needs about 3 GB.
- Set the ingestor's join threshold to the "best T (sweep)" value for the chosen model in `results.md`. Thresholds do not transfer between models.

## Switch models

1. Make sure the model is 1024-compatible and was scored in the bake-off. For a model outside the registry, re-run the bake-off with `--models <the four candidates> <new id>`. Cached models are not re-embedded, and `results.*` only lists the models named in that run.
2. Change `EMBED_MODEL_ID` (and `EMBED_MODEL_REVISION`) in `.env`, then run `docker compose -f compose.embedder.yml up -d`. Use `EMBED_HF_OFFLINE=0` for the first start if the weights are not cached yet.
3. **Re-embed everything.** Vectors from different models are not comparable: `articles.embedding`, `events.centroid` and `watches.embedding` must all be recomputed, and the ingestor threshold changed. Every response carries `"model"`, so the ingestor can refuse to mix models.

## Alternative: TEI

For a throughput comparison with the winner (TEI's own API, not our contract):

```bash
docker run --rm -p 127.0.0.1:8789:80 -v /data/mapr/models/tei:/data \
  ghcr.io/huggingface/text-embeddings-inference:cpu-1.9 \
  --model-id <winner> --max-client-batch-size 256 --auto-truncate
```

## Development

```bash
pip install -r requirements-dev.txt      # no torch needed
python -m pytest                          # 45 tests: metrics vs brute force, builder, dims, service, bake-off scoring/resume
ruff check . && ruff format --check .
```
