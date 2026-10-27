import numpy as np
import pytest

from bakeoff import metrics as M

H = 3600.0


def unit(*rows):
    a = np.asarray(rows, dtype=np.float32)
    return a / np.linalg.norm(a, axis=1, keepdims=True)


def brute_auc(s, y):
    pos, neg = s[y], s[~y]
    tot = sum(1.0 if p > n else 0.5 if p == n else 0.0 for p in pos for n in neg)
    return tot / (len(pos) * len(neg))


def test_auc_extremes_and_ties():
    y = np.array([1, 1, 0, 0], bool)
    assert M.roc_auc(np.array([0.9, 0.8, 0.2, 0.1]), y) == 1.0
    assert M.roc_auc(np.array([0.1, 0.2, 0.8, 0.9]), y) == 0.0
    assert M.roc_auc(np.array([0.5, 0.5, 0.5, 0.5]), y) == 0.5
    assert np.isnan(M.roc_auc(np.array([0.1, 0.2]), np.array([1, 1], bool)))


def test_auc_matches_brute_force():
    rng = np.random.default_rng(0)
    s = np.round(rng.random(200), 2)  # forces ties
    y = rng.random(200) < 0.3
    assert M.roc_auc(s, y) == pytest.approx(brute_auc(s, y))


def test_best_f1_threshold():
    s = np.array([0.95, 0.9, 0.7, 0.6, 0.3, 0.2])
    y = np.array([1, 1, 0, 1, 0, 0], bool)
    r = M.best_f1_threshold(s, y)
    # cut at 0.6: TP=3, predicted=4 -> P=.75 R=1 F1=.857 ; cut at 0.9: P=1 R=.667 F1=.8
    assert r["threshold"] == 0.6
    assert r["f1"] == pytest.approx(6 / 7)
    assert r["precision"] == 0.75 and r["recall"] == 1.0


def test_best_f1_ties_not_split():
    s = np.array([0.8, 0.8, 0.8])
    y = np.array([1, 0, 0], bool)
    r = M.best_f1_threshold(s, y)
    assert r["threshold"] == 0.8 and r["precision"] == pytest.approx(1 / 3)


def test_anchored_pairs_and_dups():
    v = unit([1, 0], [1, 0.1], [0, 1], [0.1, 1])
    labels = ["a", "a", "s1", "s2"]
    anchor = np.array([True, True, False, False])
    sims, same = M.anchored_pairs(v, labels, anchor)
    # pairs with an anchored member: (0,1)(0,2)(0,3)(1,2)(1,3) -> the singleton pair (2,3) is skipped
    assert len(sims) == 5 and same.sum() == 1
    sims, same = M.anchored_pairs(v, labels, anchor, dup_groups=["d", "d", None, None])
    assert len(sims) == 4 and same.sum() == 0


def test_online_cluster_threshold_and_window():
    v = unit([1, 0], [1, 0.05], [0, 1], [1, 0.02])
    t = np.array([0, 1 * H, 2 * H, 100 * H])
    pred = M.online_cluster(v, t, threshold=0.9, window_h=48)
    assert pred[0] == pred[1]  # similar, 1h apart
    assert pred[2] != pred[0]  # orthogonal
    assert pred[3] != pred[0]  # similar but 99h after the event's last article
    # threshold above any similarity -> every article is its own event
    assert len(set(M.online_cluster(v, t, threshold=1.01))) == 4


def test_online_cluster_uses_input_order_independent_of_row_order():
    v = unit([1, 0], [1, 0.05], [0, 1])
    t = np.array([5 * H, 0, 1 * H])
    pred = M.online_cluster(v, t, 0.9)
    assert pred[0] == pred[1] and pred[2] != pred[0]


def test_pairwise_prf():
    gold = ["a", "a", "b", "b"]
    assert M.pairwise_prf([0, 0, 1, 1], gold)["f1"] == 1.0
    r = M.pairwise_prf([0, 0, 0, 0], gold)  # all merged: 2 TP of 6 predicted pairs
    assert r["precision"] == pytest.approx(2 / 6) and r["recall"] == 1.0
    r = M.pairwise_prf([0, 1, 2, 3], gold)
    assert r["recall"] == 0.0 and r["f1"] == 0.0


def brute_bcubed(pred, gold, mask):
    n = len(pred)
    ps, rs = [], []
    for i in range(n):
        if not mask[i]:
            continue
        same_p = [j for j in range(n) if pred[j] == pred[i]]
        same_g = [j for j in range(n) if gold[j] == gold[i]]
        both = len(set(same_p) & set(same_g))
        ps.append(both / len(same_p))
        rs.append(both / len(same_g))
    p, r = np.mean(ps), np.mean(rs)
    return p, r, 2 * p * r / (p + r)


@pytest.mark.parametrize("seed", range(5))
def test_bcubed_matches_brute_force(seed):
    rng = np.random.default_rng(seed)
    gold = [f"g{x}" for x in rng.integers(0, 5, 30)]
    pred = list(rng.integers(0, 7, 30))
    mask = rng.random(30) < 0.6
    b = M.bcubed(pred, gold, mask)
    p, r, f = brute_bcubed(pred, gold, mask)
    assert b["precision"] == pytest.approx(p) and b["recall"] == pytest.approx(r) and b["f1"] == pytest.approx(f)


def test_bcubed_perfect_and_all_merged():
    gold = ["a", "a", "b"]
    assert M.bcubed([1, 1, 2], gold)["f1"] == 1.0
    b = M.bcubed([0, 0, 0], gold)
    assert b["recall"] == 1.0 and b["precision"] == pytest.approx((2 / 3 + 2 / 3 + 1 / 3) / 3)


def test_retrieval_recall_mrr_and_exclude():
    corpus = unit([1, 0], [0.9, 0.1], [0, 1], [0.7, 0.7])
    ids = ["q", "r1", "x", "r2"]
    q = unit([1, 0])
    queries = [{"relevant_ids": ["r1", "r2"], "exclude_ids": ["q"]}]
    r = M.retrieval(q, corpus, ids, queries, k=1)
    assert r["recall@1"] == 1.0 and r["mrr@1"] == 1.0  # q itself excluded, r1 ranks first
    queries = [{"relevant_ids": ["x"], "exclude_ids": ["q"]}]
    r = M.retrieval(q, corpus, ids, queries, k=10)
    assert r["recall@10"] == 1.0 and r["mrr@10"] == pytest.approx(1 / 3)


def test_clustering_report_and_sweep_on_synthetic_events():
    rng = np.random.default_rng(1)
    centers = rng.normal(size=(6, 32))
    rows, gold, times = [], [], []
    for e, c in enumerate(centers):
        for k in range(4):
            rows.append(c + 0.15 * rng.normal(size=32))
            gold.append(f"e{e}")
            times.append(e * 10 * H + k * H)
    v = np.asarray(rows, np.float32)
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    anchor = np.ones(len(v), bool)
    times = np.asarray(times)
    sims, same = M.anchored_pairs(v, gold, anchor)
    sep = M.separation(sims, same)
    assert sep["auc"] > 0.99
    rep = M.clustering_report(v, times, gold, anchor, sep["best_threshold"])
    assert rep["bcubed_anchored"]["f1"] > 0.95
    sweep = M.threshold_sweep(v, times, gold, anchor, [0.0, 0.5, 0.99])
    assert sweep[0]["bcubed_anchored_f1"] < sweep[1]["bcubed_anchored_f1"]


def test_fmt():
    assert M.fmt(float("nan")) == "n/a" and M.fmt(0.12345) == "0.123"


def test_label_ids_stable():
    a = M._label_ids(["x", "y", "x"])
    assert a[0] == a[2] != a[1]
