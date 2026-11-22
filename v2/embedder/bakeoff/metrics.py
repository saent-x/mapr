"""Bake-off metrics. numpy only, so they can be unit-tested without any model.

Conventions: `vecs` are L2-normalised float32 rows (cosine == dot product);
`labels` are gold event ids; `anchor` marks articles whose gold label is trusted as a
positive (members of multi-article events). Pair metrics only count pairs with at
least one anchored article, because singleton-vs-singleton "negatives" inherit the
legacy correlator's under-merging and would punish a model for being right.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np

HOUR = 3600.0


def _label_ids(labels: Sequence) -> np.ndarray:
    _, inv = np.unique(np.asarray(labels, dtype=object).astype(str), return_inverse=True)
    return inv


def anchored_pairs(
    vecs: np.ndarray,
    labels: Sequence,
    anchor: np.ndarray,
    dup_groups: Sequence | None = None,
    subset: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """(cosine, same_event) for every pair i<j with anchor[i] or anchor[j].

    dup_groups: pairs inside the same exact-duplicate group are dropped (trivial).
    subset: optional boolean mask; a pair is kept only if subset[i] or subset[j].
    """
    lab = _label_ids(labels)
    n = len(lab)
    iu, ju = np.triu_indices(n, k=1)
    keep = anchor[iu] | anchor[ju]
    if subset is not None:
        keep &= subset[iu] | subset[ju]
    if dup_groups is not None:
        dg = np.asarray([g if g else f"__{k}" for k, g in enumerate(dup_groups)], dtype=object).astype(str)
        keep &= dg[iu] != dg[ju]
    iu, ju = iu[keep], ju[keep]
    v = np.asarray(vecs, dtype=np.float32)
    sims = (v @ v.T)[iu, ju]  # n x n is small (n ~ 1000); avoids gathering pair rows
    return sims.astype(np.float64), lab[iu] == lab[ju]


def roc_auc(scores: np.ndarray, y: np.ndarray) -> float:
    """Mann-Whitney AUC with average ranks for ties. NaN if a class is empty."""
    scores = np.asarray(scores, dtype=np.float64)
    y = np.asarray(y, dtype=bool)
    n_pos, n_neg = int(y.sum()), int((~y).sum())
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    order = np.argsort(scores, kind="mergesort")
    s = scores[order]
    ranks = np.empty(len(s), dtype=np.float64)
    # average rank per tie block (1-based)
    _, start, counts = np.unique(s, return_index=True, return_counts=True)
    avg = start + (counts + 1) / 2.0
    ranks[order] = np.repeat(avg, counts)
    return float((ranks[y].sum() - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg))


def best_f1_threshold(scores: np.ndarray, y: np.ndarray) -> dict:
    """Threshold T maximising F1 of the rule `same event iff cosine >= T`."""
    scores = np.asarray(scores, dtype=np.float64)
    y = np.asarray(y, dtype=bool)
    n_pos = int(y.sum())
    if n_pos == 0 or len(scores) == 0:
        return {"threshold": float("nan"), "f1": float("nan"), "precision": float("nan"), "recall": float("nan")}
    order = np.argsort(-scores, kind="mergesort")
    s, t = scores[order], y[order]
    tp = np.cumsum(t)
    k = np.arange(1, len(s) + 1)
    # Only cut where the next score is strictly lower, so ties fall on one side.
    last_of_block = np.r_[s[1:] < s[:-1], True]
    tp, k, s_cut = tp[last_of_block], k[last_of_block], s[last_of_block]
    precision = tp / k
    recall = tp / n_pos
    with np.errstate(invalid="ignore", divide="ignore"):
        f1 = np.where(tp > 0, 2 * precision * recall / (precision + recall), 0.0)
    b = int(np.argmax(f1))
    return {
        "threshold": float(s_cut[b]),
        "f1": float(f1[b]),
        "precision": float(precision[b]),
        "recall": float(recall[b]),
    }


def separation(sims: np.ndarray, same: np.ndarray) -> dict:
    out = {
        "pairs": len(sims),
        "positive_pairs": int(same.sum()),
        "auc": roc_auc(sims, same),
        "mean_cos_same": float(sims[same].mean()) if same.any() else float("nan"),
        "mean_cos_diff": float(sims[~same].mean()) if (~same).any() else float("nan"),
    }
    out.update({f"best_{k}": v for k, v in best_f1_threshold(sims, same).items()})
    return out


def online_cluster(vecs: np.ndarray, times: np.ndarray, threshold: float, window_h: float = 48.0) -> np.ndarray:
    """The ingestor's rule, replayed in publish order.

    For each article: among events whose last article is within `window_h` hours,
    take the one with the most similar centroid; join it if cosine >= threshold,
    otherwise open a new event. Centroid = normalised mean of member vectors.
    Returns a predicted event index per article (input order).
    """
    n, d = vecs.shape
    order = np.lexsort((np.arange(n), times))
    window = window_h * HOUR
    sums = np.zeros((n, d), dtype=np.float64)
    cents = np.zeros((n, d), dtype=np.float32)
    last_seen = np.full(n, -np.inf)
    pred = np.empty(n, dtype=np.int64)
    m = 0
    for i in order:
        v, t = vecs[i], times[i]
        j = -1
        if m:
            active = np.abs(t - last_seen[:m]) <= window
            if active.any():
                sims = cents[:m] @ v
                sims[~active] = -np.inf
                cand = int(np.argmax(sims))
                if sims[cand] >= threshold:
                    j = cand
        if j < 0:
            j = m
            m += 1
        sums[j] += v
        nrm = np.linalg.norm(sums[j])
        cents[j] = sums[j] / nrm if nrm > 0 else sums[j]
        last_seen[j] = max(last_seen[j], t)
        pred[i] = j
    return pred


def pairwise_prf(pred: Sequence, gold: Sequence, anchor: np.ndarray | None = None) -> dict:
    """Pair-counting precision/recall/F1 over pairs (optionally anchored, like `anchored_pairs`)."""
    p = np.asarray(pred)
    g = _label_ids(gold)
    n = len(p)
    iu, ju = np.triu_indices(n, k=1)
    if anchor is not None:
        keep = anchor[iu] | anchor[ju]
        iu, ju = iu[keep], ju[keep]
    sp = p[iu] == p[ju]
    sg = g[iu] == g[ju]
    tp = int((sp & sg).sum())
    n_pred, n_gold = int(sp.sum()), int(sg.sum())
    prec = tp / n_pred if n_pred else (1.0 if n_gold == 0 else 0.0)
    rec = tp / n_gold if n_gold else float("nan")
    f1 = 2 * prec * rec / (prec + rec) if prec + rec > 0 else 0.0
    return {"precision": prec, "recall": rec, "f1": f1, "pred_pairs": n_pred, "gold_pairs": n_gold}


def bcubed(pred: Sequence, gold: Sequence, eval_mask: np.ndarray | None = None) -> dict:
    """B-cubed precision/recall/F1, averaged over items in eval_mask (all if None).

    Cluster sizes always use the whole dataset, so merging an evaluated article with
    a distractor still costs precision.
    """
    p = np.asarray(pred)
    g = _label_ids(gold)
    n = len(p)
    mask = np.ones(n, dtype=bool) if eval_mask is None else np.asarray(eval_mask, dtype=bool)
    if not mask.any():
        return {"precision": float("nan"), "recall": float("nan"), "f1": float("nan"), "items": 0}
    # joint counts via a combined key
    pk = {v: k for k, v in enumerate(np.unique(p))}
    pi = np.fromiter((pk[v] for v in p), dtype=np.int64, count=n)
    joint = pi * (g.max() + 1) + g
    _, jinv, jcnt = np.unique(joint, return_inverse=True, return_counts=True)
    _, pinv, pcnt = np.unique(pi, return_inverse=True, return_counts=True)
    _, ginv, gcnt = np.unique(g, return_inverse=True, return_counts=True)
    both = jcnt[jinv][mask].astype(np.float64)
    prec = float(np.mean(both / pcnt[pinv][mask]))
    rec = float(np.mean(both / gcnt[ginv][mask]))
    f1 = 2 * prec * rec / (prec + rec) if prec + rec > 0 else 0.0
    return {"precision": prec, "recall": rec, "f1": f1, "items": int(mask.sum())}


def clustering_report(vecs, times, gold, anchor, threshold, window_h=48.0) -> dict:
    pred = online_cluster(vecs, times, threshold, window_h)
    return {
        "threshold": float(threshold),
        "events_predicted": len(np.unique(pred)),
        "events_gold": len(np.unique(np.asarray(gold, dtype=object).astype(str))),
        "pairwise_anchored": pairwise_prf(pred, gold, anchor),
        "bcubed_anchored": bcubed(pred, gold, anchor),
        "bcubed_all": bcubed(pred, gold, None),
    }


def threshold_sweep(vecs, times, gold, anchor, grid, window_h=48.0) -> list[dict]:
    rows = []
    for t in grid:
        pred = online_cluster(vecs, times, float(t), window_h)
        b = bcubed(pred, gold, anchor)
        pw = pairwise_prf(pred, gold, anchor)
        rows.append({"threshold": round(float(t), 4), "bcubed_anchored_f1": b["f1"], "pairwise_anchored_f1": pw["f1"]})
    return rows


def retrieval(
    query_vecs: np.ndarray,
    corpus_vecs: np.ndarray,
    corpus_ids: Sequence[str],
    queries: Sequence[dict],
    k: int = 10,
) -> dict:
    """recall@k and MRR@k. Each query dict has relevant_ids and exclude_ids."""
    index = {cid: i for i, cid in enumerate(corpus_ids)}
    recalls, rrs = [], []
    for qv, q in zip(query_vecs, queries, strict=True):
        sims = corpus_vecs @ qv
        for cid in q.get("exclude_ids", []):
            if cid in index:
                sims[index[cid]] = -np.inf
        rel = {index[r] for r in q["relevant_ids"] if r in index}
        if not rel:
            continue
        top = np.argsort(-sims, kind="mergesort")[:k]
        hits = [i for i in top if i in rel]
        recalls.append(len(hits) / min(len(rel), k))
        rr = 0.0
        for rank, i in enumerate(top, 1):
            if i in rel:
                rr = 1.0 / rank
                break
        rrs.append(rr)
    nq = len(recalls)
    return {
        "queries": nq,
        f"recall@{k}": float(np.mean(recalls)) if nq else float("nan"),
        f"mrr@{k}": float(np.mean(rrs)) if nq else float("nan"),
    }


def fmt(x: float, nd: int = 3) -> str:
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "n/a"
    return f"{x:.{nd}f}"
