"""Embedding-model bake-off for MAPR v2. Runs on the embedding server (CPU only).

    python -m bakeoff.run --cache-dir /data/mapr/models --out bakeoff

For each candidate, in its own subprocess (so one crash / OOM cannot take the run down
and peak RAM is per model):
  1. prefetch: download weights into --cache-dir (not timed as load time);
  2. measure: load from local disk (offline), embed every article (documents) and every
     retrieval query (with the model's query instruction) at batch 32, record timings,
     peak RSS and vectors to <out>/runs/<slug>/.
The parent then scores every model from the saved vectors and writes results.json and
results.md. Re-running skips models whose vectors already exist for the same dataset
and settings (resumable); --force recomputes. Use --models to pick candidates.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import random
import re
import resource
import subprocess
import sys
import time
import traceback
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bakeoff import metrics as M  # noqa: E402
from mapr_embedder.models import DEFAULT_CANDIDATES, TARGET_DIMS, get_spec, plan_dims  # noqa: E402

SEED = 13
SWEEP = np.round(np.arange(0.30, 0.951, 0.01), 2)


def slug(model_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "__", model_id)


def load_jsonl(p: Path) -> list[dict]:
    with open(p, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def file_sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_key(args, dataset: Path, queries: Path) -> str:
    cfg = {
        "dataset": file_sha(dataset),
        "queries": file_sha(queries),
        "batch_size": args.batch_size,
        "max_seq_length": args.max_seq_length,
        "threads": args.threads,
    }
    return hashlib.sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest()[:16]


def set_seeds() -> None:
    random.seed(SEED)
    np.random.seed(SEED)
    try:
        import torch

        torch.manual_seed(SEED)
    except ImportError:
        pass


def rss_mb() -> float:
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) / 1024
    except OSError:
        pass
    return float("nan")


def peak_rss_mb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024  # Linux: KiB


# ----------------------------------------------------------------------------- child


def child_prefetch(args) -> int:
    """Download (or verify) the weights. A separate process so its RAM never counts."""
    from mapr_embedder.encoder import Encoder

    t0 = time.perf_counter()
    Encoder(args.model, cache_dir=args.cache_dir, max_seq_length=args.max_seq_length, require_compatible=False)
    print(json.dumps({"prefetch_seconds": time.perf_counter() - t0}))
    return 0


def child_measure(args) -> int:
    out = Path(args.run_dir)
    out.mkdir(parents=True, exist_ok=True)
    meta: dict = {"model": args.model, "run_key": args.run_key, "status": "error"}
    try:
        set_seeds()
        import sentence_transformers
        import torch
        import transformers

        from mapr_embedder.encoder import Encoder

        torch.use_deterministic_algorithms(True, warn_only=True)
        rows = load_jsonl(Path(args.dataset))
        queries = load_jsonl(Path(args.queries))
        docs = [r["text"] for r in rows]
        qtexts = [q["query"] for q in queries]
        rss_before = rss_mb()

        enc = Encoder(
            args.model,
            cache_dir=args.cache_dir,
            max_seq_length=args.max_seq_length,
            threads=args.threads,
            require_compatible=False,
        )
        rss_loaded = rss_mb()

        try:  # token-length stats are informative only; never fail a run over them
            tok = enc.model.tokenizer
            lens = np.array([len(x) for x in tok(docs, add_special_tokens=True, truncation=False)["input_ids"]])
            tok_stats = {
                "mean_tokens": round(float(lens.mean()), 1),
                "p95_tokens": int(np.percentile(lens, 95)),
                "truncated_fraction": round(float(np.mean(lens > args.max_seq_length)), 4),
            }
        except Exception as exc:
            tok_stats = {
                "mean_tokens": None,
                "p95_tokens": None,
                "truncated_fraction": None,
                "token_stats_error": str(exc),
            }

        enc.encode(docs[: args.batch_size], "document", args.batch_size)  # warm-up, untimed
        t0 = time.perf_counter()
        dvec = enc.encode(docs, "document", args.batch_size)
        doc_s = time.perf_counter() - t0
        t0 = time.perf_counter()
        qvec = enc.encode(qtexts, "query", args.batch_size)
        q_s = time.perf_counter() - t0

        norms = np.linalg.norm(dvec, axis=1)
        np.savez_compressed(out / "vectors.npz", docs=dvec, queries=qvec)
        meta.update(
            {
                "status": "ok",
                "native_dims": enc.native_dims,
                "out_dims": int(dvec.shape[1]),
                "dim_plan": enc.plan.reason,
                "compatible_1024": enc.plan.compatible,
                "prompts": enc.prompt_names,
                "load_seconds": round(enc.load_seconds, 3),
                "docs": len(docs),
                "doc_encode_seconds": round(doc_s, 3),
                "docs_per_second": round(len(docs) / doc_s, 2),
                "queries": len(qtexts),
                "query_encode_seconds": round(q_s, 3),
                "queries_per_second": round(len(qtexts) / q_s, 2) if q_s else None,
                **tok_stats,
                "rss_mb_before_load": round(rss_before, 1),
                "rss_mb_after_load": round(rss_loaded, 1),
                "peak_rss_mb": round(peak_rss_mb(), 1),
                "norm_min": float(norms.min()),
                "norm_max": float(norms.max()),
                "batch_size": args.batch_size,
                "threads": args.threads,
                "torch_threads": torch.get_num_threads(),
                "versions": {
                    "torch": torch.__version__,
                    "transformers": transformers.__version__,
                    "sentence_transformers": sentence_transformers.__version__,
                    "python": platform.python_version(),
                },
                "finished_at": datetime.now(UTC).isoformat(),
            }
        )
        rc = 0
    except Exception as exc:  # recorded, parent moves on to the next model
        meta["error"] = f"{type(exc).__name__}: {exc}"
        meta["traceback"] = traceback.format_exc()[-4000:]
        rc = 1
    (out / "meta.json").write_text(json.dumps(meta, indent=2))
    return rc


# ---------------------------------------------------------------------------- parent


def spawn(mode: str, args, model: str, run_dir: Path, key: str, offline: bool) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    n = str(args.threads)
    env.update(
        {
            "OMP_NUM_THREADS": n,
            "MKL_NUM_THREADS": n,
            "OPENBLAS_NUM_THREADS": n,
            "TOKENIZERS_PARALLELISM": "false",
            "PYTHONHASHSEED": str(SEED),
        }
    )
    if offline:
        env["HF_HUB_OFFLINE"] = "1"
    cmd = [
        sys.executable, "-m", "bakeoff.run", f"--{mode}",
        "--model", model,
        "--run-dir", str(run_dir),
        "--run-key", key,
        "--dataset", str(args.dataset),
        "--queries", str(args.queries),
        "--cache-dir", args.cache_dir,
        "--batch-size", str(args.batch_size),
        "--threads", str(args.threads),
        "--max-seq-length", str(args.max_seq_length),
    ]  # fmt: skip
    return subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True, timeout=args.timeout)


def ensure_vectors(args, model: str, key: str) -> dict:
    run_dir = Path(args.out) / "runs" / slug(model)
    meta_p = run_dir / "meta.json"
    if not args.force and meta_p.exists() and (run_dir / "vectors.npz").exists():
        meta = json.loads(meta_p.read_text())
        if meta.get("status") == "ok" and meta.get("run_key") == key:
            print(f"[{model}] cached vectors, skipping embed", flush=True)
            return meta
    run_dir.mkdir(parents=True, exist_ok=True)
    prefetch: dict = {}
    for mode, offline in (("prefetch", False), ("measure", True)):
        print(f"[{model}] {mode} ...", flush=True)
        try:
            cp = spawn(mode, args, model, run_dir, key, offline)
        except subprocess.TimeoutExpired:
            meta = {"model": model, "status": "error", "error": f"{mode} timed out after {args.timeout}s"}
            meta_p.write_text(json.dumps(meta, indent=2))
            return meta
        (run_dir / f"{mode}.log").write_text(cp.stdout + "\n--- stderr ---\n" + cp.stderr)
        if cp.returncode != 0:
            meta = json.loads(meta_p.read_text()) if mode == "measure" and meta_p.exists() else {}
            if meta.get("run_key") != key:
                meta = {}
            meta.setdefault("model", model)
            meta["status"] = "error"
            meta.setdefault(
                "error", f"{mode} exited {cp.returncode}" + (" (killed: out of memory?)" if cp.returncode < 0 else "")
            )
            meta["stderr_tail"] = cp.stderr[-3000:]
            meta_p.write_text(json.dumps(meta, indent=2))
            return meta
        if mode == "prefetch":
            try:
                prefetch = json.loads(cp.stdout.strip().splitlines()[-1])
            except (ValueError, IndexError):
                prefetch = {}
    meta = json.loads(meta_p.read_text())
    meta.update(prefetch)
    meta_p.write_text(json.dumps(meta, indent=2))
    return meta


def score(rows, queries, dvec, qvec) -> dict:
    labels = [r["event_id"] for r in rows]
    anchor = np.array([r["event_size"] >= 2 for r in rows])
    dups = [r.get("dup_group") for r in rows]
    non_en = np.array([r["lang"] not in ("en", "und") for r in rows])
    times = np.array(
        [datetime.fromisoformat(r["published_at"].replace("Z", "+00:00")).timestamp() if r["published_at"] else 0.0
         for r in rows]
    )  # fmt: skip

    sims, same = M.anchored_pairs(dvec, labels, anchor)
    sep = M.separation(sims, same)
    sims_nt, same_nt = M.anchored_pairs(dvec, labels, anchor, dup_groups=dups)
    sep_nt = M.separation(sims_nt, same_nt)
    sims_ne, same_ne = M.anchored_pairs(dvec, labels, anchor, dup_groups=dups, subset=non_en)
    sep_ne = M.separation(sims_ne, same_ne)

    t_pair = sep_nt["best_threshold"]
    clus = M.clustering_report(dvec, times, labels, anchor, t_pair)
    sweep = M.threshold_sweep(dvec, times, labels, anchor, SWEEP)
    best = max(sweep, key=lambda r: (r["bcubed_anchored_f1"], -abs(r["threshold"] - t_pair)))
    clus_best = M.clustering_report(dvec, times, labels, anchor, best["threshold"])

    ids = [r["id"] for r in rows]
    ret = M.retrieval(qvec, dvec, ids, queries, k=10)
    ne_idx = [i for i, q in enumerate(queries) if q.get("lang") not in ("en", "und")]
    ret_ne = M.retrieval(qvec[ne_idx], dvec, ids, [queries[i] for i in ne_idx], k=10) if ne_idx else None
    return {
        "separation": sep,
        "separation_non_trivial": sep_nt,
        "separation_non_english": sep_ne,
        "clustering_at_pair_threshold": clus,
        "clustering_at_best_threshold": clus_best,
        "threshold_sweep": sweep,
        "retrieval": ret,
        "retrieval_non_english": ret_ne,
    }


def pick_winner(results: list[dict]) -> dict | None:
    ok = [r for r in results if r["status"] == "ok" and r.get("compatible_1024")]
    if not ok:
        return None

    def key(r):
        s = r["scores"]
        return (
            round(s["clustering_at_best_threshold"]["bcubed_anchored"]["f1"], 2),
            round(s["retrieval"]["recall@10"], 2),
            r["docs_per_second"],
        )

    return max(ok, key=key)


def write_md(path: Path, results: list[dict], winner: dict | None, stats: dict, key: str) -> None:
    f = M.fmt
    L = [
        "# MAPR v2 embedding bake-off",
        "",
        f"Generated {datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC')} · run key `{key}` · "
        f"{stats.get('articles', '?')} articles, {stats.get('positive_events', '?')} multi-article events, "
        f"{stats.get('positive_pairs', '?')} positive pairs, {stats.get('queries', '?')} retrieval queries.",
        "",
        "Pair metrics are anchored (at least one article from a multi-article event); "
        "*non-trivial* drops exact-duplicate text pairs. Clustering replays the ingestor rule "
        "(join the most similar centroid within 48 h if cosine >= T, else open an event).",
        "",
        "## Summary",
        "",
        "| model | 1024? | AUC | AUC non-trivial | AUC non-en | best-F1 T | pair F1 | B3 F1 @T | best T (sweep) | B3 F1 @best | recall@10 | MRR@10 | docs/s | load s | peak RAM MB |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        if r["status"] != "ok":
            continue
        s = r["scores"]
        sep, nt, ne = s["separation"], s["separation_non_trivial"], s["separation_non_english"]
        c1, c2 = s["clustering_at_pair_threshold"], s["clustering_at_best_threshold"]
        L.append(
            f"| {r['model']} | {'yes' if r['compatible_1024'] else 'NO (' + str(r['native_dims']) + ')'} "
            f"| {f(sep['auc'])} | {f(nt['auc'])} | {f(ne['auc'])} | {f(nt['best_threshold'], 2)} | {f(nt['best_f1'])} "
            f"| {f(c1['bcubed_anchored']['f1'])} | {f(c2['threshold'], 2)} | {f(c2['bcubed_anchored']['f1'])} "
            f"| {f(s['retrieval']['recall@10'])} | {f(s['retrieval']['mrr@10'])} "
            f"| {r['docs_per_second']:.1f} | {r['load_seconds']:.1f} | {r['peak_rss_mb']:.0f} |"
        )
    failed = [r for r in results if r["status"] != "ok"]
    if failed:
        L += ["", "Failed: " + "; ".join(f"**{r['model']}** ({r.get('error', '?')})" for r in failed)]
    L += ["", "## Recommendation", ""]
    if winner:
        c2 = winner["scores"]["clustering_at_best_threshold"]
        L.append(
            f"**{winner['model']}**: highest anchored B-cubed F1 among 1024-compatible models "
            f"(ties within 0.01 broken by recall@10, then throughput). Suggested ingestor join threshold "
            f"T = {c2['threshold']:.2f} (B-cubed F1 {c2['bcubed_anchored']['f1']:.3f})."
        )
    else:
        L.append("No 1024-compatible model finished; see failures above.")
    L.append("")
    for r in results:
        L += [f"## {r['model']}", ""]
        if r["status"] != "ok":
            L += [
                f"Failed: `{r.get('error')}`",
                "",
                "```",
                (r.get("stderr_tail") or r.get("traceback") or "")[-1500:],
                "```",
                "",
            ]
            continue
        s = r["scores"]
        c1, c2 = s["clustering_at_pair_threshold"], s["clustering_at_best_threshold"]
        ne = s.get("retrieval_non_english") or {}
        L += [
            f"- dims: native {r['native_dims']} -> {r['out_dims']} ({r['dim_plan']}); compatible with vector(1024): {r['compatible_1024']}",
            f"- prompts: {r['prompts']}",
            f"- separation (all / non-trivial / non-English): AUC {f(s['separation']['auc'])} / {f(s['separation_non_trivial']['auc'])} / {f(s['separation_non_english']['auc'])}; "
            f"mean cos same {f(s['separation_non_trivial']['mean_cos_same'])} vs diff {f(s['separation_non_trivial']['mean_cos_diff'])}",
            f"- best pair threshold {f(s['separation_non_trivial']['best_threshold'], 3)}: F1 {f(s['separation_non_trivial']['best_f1'])} "
            f"(P {f(s['separation_non_trivial']['best_precision'])}, R {f(s['separation_non_trivial']['best_recall'])})",
            f"- clustering @T={c1['threshold']:.3f}: pairwise P/R/F1 {f(c1['pairwise_anchored']['precision'])}/{f(c1['pairwise_anchored']['recall'])}/{f(c1['pairwise_anchored']['f1'])}, "
            f"B-cubed anchored F1 {f(c1['bcubed_anchored']['f1'])}, all-items F1 {f(c1['bcubed_all']['f1'])}, {c1['events_predicted']} events (gold {c1['events_gold']})",
            f"- clustering @best T={c2['threshold']:.2f}: pairwise F1 {f(c2['pairwise_anchored']['f1'])}, B-cubed anchored F1 {f(c2['bcubed_anchored']['f1'])}, all-items F1 {f(c2['bcubed_all']['f1'])}",
            f"- retrieval: recall@10 {f(s['retrieval']['recall@10'])}, MRR@10 {f(s['retrieval']['mrr@10'])} over {s['retrieval']['queries']} queries; "
            f"non-English queries ({ne.get('queries', 0)}): recall@10 {f(ne.get('recall@10', float('nan')))}",
            f"- speed: {r['docs_per_second']:.1f} docs/s at batch {r['batch_size']} on {r['torch_threads']} threads "
            f"(mean {r['mean_tokens']} tokens, p95 {r['p95_tokens']}, truncated fraction {r['truncated_fraction']}); "
            f"queries {r.get('queries_per_second')}/s; load {r['load_seconds']:.1f}s; peak RSS {r['peak_rss_mb']:.0f} MB",
            f"- versions: {r.get('versions')}",
            "",
        ]
    path.write_text("\n".join(L) + "\n")


def parent(args) -> int:
    dataset, queries_p = Path(args.dataset), Path(args.queries)
    rows, queries = load_jsonl(dataset), load_jsonl(queries_p)
    stats_p = dataset.with_name("dataset_stats.json")
    stats = json.loads(stats_p.read_text()) if stats_p.exists() else {}
    key = run_key(args, dataset, queries_p)
    Path(args.out).mkdir(parents=True, exist_ok=True)
    set_seeds()

    results = []
    for model in args.models:
        spec = get_spec(model)
        entry: dict = {"model": model, "license": spec.license, "gated": spec.gated, "arch": spec.arch}
        meta = ensure_vectors(args, model, key)
        entry.update({k: v for k, v in meta.items() if k not in ("traceback",)})
        if meta.get("status") == "ok":
            try:
                data = np.load(Path(args.out) / "runs" / slug(model) / "vectors.npz")
                entry["scores"] = score(rows, queries, data["docs"], data["queries"])
            except Exception as exc:
                entry["status"] = "error"
                entry["error"] = f"scoring failed: {type(exc).__name__}: {exc}"
                entry["traceback"] = traceback.format_exc()[-3000:]
        else:
            plan = plan_dims(spec.native_dims, spec.matryoshka, TARGET_DIMS) if spec.native_dims else None
            if plan:
                entry["compatible_1024"] = plan.compatible
                entry["dim_plan"] = plan.reason
        results.append(entry)
        print(
            f"[{model}] {entry['status']}" + (f": {entry.get('error')}" if entry["status"] != "ok" else ""), flush=True
        )

    winner = pick_winner(results)
    out = {
        "generated_at": datetime.now(UTC).isoformat(),
        "run_key": key,
        "host": {"machine": platform.machine(), "cpus": os.cpu_count(), "python": platform.python_version()},
        "settings": {
            "batch_size": args.batch_size,
            "threads": args.threads,
            "max_seq_length": args.max_seq_length,
            "window_hours": 48,
            "seed": SEED,
        },
        "dataset": {k: v for k, v in stats.items() if k not in ("excluded_positive_events", "kept_positive_events")},
        "winner": winner["model"] if winner else None,
        "results": results,
    }
    (Path(args.out) / "results.json").write_text(json.dumps(out, indent=2, ensure_ascii=False))
    write_md(Path(args.out) / "results.md", results, winner, stats, key)
    print(f"wrote {Path(args.out) / 'results.json'} and results.md; winner: {out['winner']}")
    return 0 if any(r["status"] == "ok" for r in results) else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", nargs="+", default=DEFAULT_CANDIDATES)
    ap.add_argument("--dataset", default=str(HERE / "dataset.jsonl"))
    ap.add_argument("--queries", default=str(HERE / "queries.jsonl"))
    ap.add_argument("--out", default=str(HERE))
    ap.add_argument("--cache-dir", default=os.environ.get("MODEL_CACHE_DIR", "/data/mapr/models"))
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--threads", type=int, default=12)
    ap.add_argument("--max-seq-length", type=int, default=512)
    ap.add_argument("--timeout", type=int, default=3 * 3600, help="seconds per model step")
    ap.add_argument("--force", action="store_true", help="re-embed even if cached vectors exist")
    # internal
    ap.add_argument("--prefetch", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--measure", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--model", help=argparse.SUPPRESS)
    ap.add_argument("--run-dir", help=argparse.SUPPRESS)
    ap.add_argument("--run-key", help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    if args.prefetch:
        return child_prefetch(args)
    if args.measure:
        return child_measure(args)
    return parent(args)


if __name__ == "__main__":
    sys.exit(main())
