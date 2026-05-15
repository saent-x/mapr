#!/usr/bin/env python3
"""Benchmark active llama.cpp server models for Mapr AI.

This script is intentionally small and dependency-light. Run it from a host or
container that can reach a llama.cpp OpenAI-compatible server. If you benchmark
several GGUFs, restart llama.cpp with each LLAMA_CPP_MODEL_FILE first so only
one model is resident at a time on the low-RAM home PC.

Example:
  LLAMA_CPP_BASE_URL=http://llama-cpp:8080 \
  LLAMA_MODEL=qwen2.5-1.5b-instruct-q4_k_m.gguf \
  python home-pc/scripts/benchmark_llama_models.py
"""
from __future__ import annotations

import json
import os
import statistics
import time
import urllib.error
import urllib.request

BASE_URL = os.environ.get("LLAMA_CPP_BASE_URL", "http://localhost:8080").rstrip("/")
MODEL = os.environ.get("LLAMA_MODEL") or os.environ.get("LLM_MODEL") or "active-model"
RUNS = int(os.environ.get("BENCH_RUNS", "3"))
MAX_TOKENS = int(os.environ.get("BENCH_MAX_TOKENS", "120"))
TIMEOUT = float(os.environ.get("BENCH_TIMEOUT_S", "120"))

PROMPTS = [
    {
        "name": "hello",
        "messages": [
            {"role": "system", "content": "You are a concise assistant."},
            {"role": "user", "content": "Say hello in one short sentence."},
        ],
        "max_tokens": 40,
    },
    {
        "name": "rag_summary",
        "messages": [
            {"role": "system", "content": "You are Mapr's assistant. Answer concisely and cite sources as [1], [2]."},
            {
                "role": "user",
                "content": (
                    "Question:\nWhat changed in the latest regional security briefing?\n\n"
                    "Sources:\n"
                    "[1] Border talks resume — Reuters: Officials resumed border-security talks after a week of clashes.\n"
                    "[2] Energy infrastructure alert — AP: Operators increased monitoring after drones were reported near substations.\n"
                    "Answer in 3 bullets."
                ),
            },
        ],
        "max_tokens": MAX_TOKENS,
    },
]


def post_chat(messages, max_tokens):
    body = json.dumps(
        {
            "model": MODEL,
            "messages": messages,
            "stream": False,
            "temperature": 0.2,
            "max_tokens": max_tokens,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}/v1/chat/completions",
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    wall_s = time.perf_counter() - t0
    usage = data.get("usage") or {}
    text = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    out_tokens = int(usage.get("completion_tokens") or 0)
    in_tokens = int(usage.get("prompt_tokens") or 0)
    return {
        "wall_ms": round(wall_s * 1000),
        "tokens_in": in_tokens,
        "tokens_out": out_tokens,
        "output_tok_s": round(out_tokens / wall_s, 2) if wall_s > 0 and out_tokens else None,
        "total_tok_s": round((in_tokens + out_tokens) / wall_s, 2) if wall_s > 0 and (in_tokens + out_tokens) else None,
        "chars_out": len(text),
        "sample": text[:240],
    }


def main():
    results = {"base_url": BASE_URL, "model": MODEL, "runs_per_prompt": RUNS, "prompts": []}
    # warm-up, ignored
    try:
        post_chat(PROMPTS[0]["messages"], 16)
    except Exception as e:
        raise SystemExit(f"warmup failed for {BASE_URL}: {e!r}")

    for prompt in PROMPTS:
        runs = []
        for _ in range(RUNS):
            runs.append(post_chat(prompt["messages"], prompt["max_tokens"]))
        tok_s = [r["output_tok_s"] for r in runs if r["output_tok_s"]]
        wall = [r["wall_ms"] for r in runs]
        results["prompts"].append(
            {
                "name": prompt["name"],
                "max_tokens": prompt["max_tokens"],
                "median_output_tok_s": round(statistics.median(tok_s), 2) if tok_s else None,
                "median_wall_ms": round(statistics.median(wall)),
                "runs": runs,
            }
        )
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
