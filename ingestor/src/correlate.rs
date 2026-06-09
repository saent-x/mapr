//! Event correlation: cluster articles into events by title token-set Jaccard
//! AND shared region within a time window, then assign a stable `eventKey`.
//!
//! Two articles correlate when: same ISO region, |Δ publishedAt| ≤ window
//! (default 72h), and token Jaccard ≥ 0.25. Single-link clustering: an article
//! joins the first cluster containing any member it correlates with. The event
//! tier escalates to the highest contributing article tier (the Convex side
//! recomputes the authoritative event, but we pre-assign so a batch is coherent).

use std::collections::{HashMap, HashSet};

use sha2::{Digest, Sha256};

use crate::dedup::jaccard;
use crate::model::Tier;

/// Default correlation window (72h). The spec's 24–72h band is the operating
/// range; 72h is the outer bound used for grouping.
pub const CORRELATION_WINDOW_MS: i64 = 72 * 3_600 * 1_000;

/// Minimum token Jaccard for two articles to be considered the same event.
pub const CORRELATION_JACCARD: f64 = 0.25;

/// One article's correlation inputs.
#[derive(Debug, Clone)]
pub struct CorrelationItem {
    pub external_id: String,
    pub iso_a2: String,
    pub published_at: i64,
    pub tier: Tier,
    pub tokens: Vec<String>,
}

/// Correlation output: per-item event key (same order as input) + the escalated
/// tier per event key.
#[derive(Debug, Clone)]
pub struct CorrelationResult {
    pub event_keys: Vec<String>,
    pub event_tier: HashMap<String, Tier>,
}

fn hash8(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(16);
    for b in digest.iter().take(4) {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Cycle-invariant content signature for a cluster: the tokens shared by a
/// MAJORITY of the cluster's articles (a story's core terms — region names,
/// actors, the event noun — that stay constant as new articles arrive across
/// cycles), sorted for determinism. Falls back to the most-frequent tokens for
/// a single-article cluster. This keeps an ongoing event's key stable from one
/// ingest cycle to the next, instead of drifting with batch membership.
fn cluster_token_signature(cluster: &[usize], items: &[CorrelationItem]) -> String {
    let n = cluster.len();
    let threshold = n / 2 + 1; // strict majority (n==1 -> 1, 2 -> 2, 3 -> 2, 4 -> 3)
    let mut freq: HashMap<&str, usize> = HashMap::new();
    for &i in cluster {
        let mut seen: HashSet<&str> = HashSet::new();
        for t in &items[i].tokens {
            if t.len() < 3 {
                continue;
            }
            if seen.insert(t.as_str()) {
                *freq.entry(t.as_str()).or_insert(0) += 1;
            }
        }
    }
    // Tokens present in a majority of the cluster's articles (stable consensus).
    let mut sig: Vec<&str> = freq
        .iter()
        .filter(|&(_, &c)| c >= threshold)
        .map(|(&t, _)| t)
        .collect();
    if sig.is_empty() {
        // No consensus (e.g. single article): fall back to the most-frequent
        // tokens, tie-broken lexicographically for determinism.
        let mut ranked: Vec<(&str, usize)> = freq.into_iter().collect();
        ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
        sig = ranked.into_iter().take(6).map(|(t, _)| t).collect();
    }
    sig.sort_unstable();
    sig.join("-")
}

fn correlates(a: &CorrelationItem, b: &CorrelationItem, window_ms: i64) -> bool {
    a.iso_a2 == b.iso_a2
        && (a.published_at - b.published_at).abs() <= window_ms
        && jaccard(&a.tokens, &b.tokens) >= CORRELATION_JACCARD
}

/// Correlate using the default 72h window.
pub fn correlate(items: &[CorrelationItem]) -> CorrelationResult {
    correlate_with(items, CORRELATION_WINDOW_MS)
}

/// Correlate with an explicit window (ms).
pub fn correlate_with(items: &[CorrelationItem], window_ms: i64) -> CorrelationResult {
    // Single-link clustering by index.
    let mut clusters: Vec<Vec<usize>> = Vec::new();
    for (i, item) in items.iter().enumerate() {
        let mut joined = None;
        for (ci, cluster) in clusters.iter().enumerate() {
            if cluster
                .iter()
                .any(|&j| correlates(item, &items[j], window_ms))
            {
                joined = Some(ci);
                break;
            }
        }
        match joined {
            Some(ci) => clusters[ci].push(i),
            None => clusters.push(vec![i]),
        }
    }

    let mut event_keys = vec![String::new(); items.len()];
    let mut event_tier: HashMap<String, Tier> = HashMap::new();
    for cluster in &clusters {
        // Cycle-invariant key: derive from the cluster's CONSENSUS tokens (the
        // story's core terms, shared across its articles) + region — NOT the
        // in-batch min externalId, which shifts every cycle (old articles aren't
        // re-fetched, new ones arrive with different ids) and so fragments one
        // ongoing situation into a brand-new event each cycle.
        let region = items[cluster[0]].iso_a2.to_lowercase();
        let region = if region.is_empty() {
            "xx".to_string()
        } else {
            region
        };
        // Coarse day bucket (from the cluster's earliest article) so two
        // same-topic stories far apart in time stay distinct events, while
        // every ingest cycle WITHIN a day keys to the SAME event (the fix:
        // per-cycle fragmentation collapses to at most one split per day).
        let day = cluster
            .iter()
            .map(|&i| items[i].published_at)
            .min()
            .unwrap_or(0)
            / 86_400_000;
        let signature = cluster_token_signature(cluster, items);
        let key = format!("evt-{}-{}-{}", region, day, hash8(&signature));

        // Escalate tier to the cluster maximum.
        let max_tier = cluster
            .iter()
            .map(|&i| items[i].tier)
            .max_by_key(|t| t.rank())
            .unwrap_or(Tier::Green);
        event_tier.insert(key.clone(), max_tier);

        for &i in cluster {
            event_keys[i] = key.clone();
        }
    }

    CorrelationResult {
        event_keys,
        event_tier,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dedup::title_tokens;

    fn item(id: &str, iso: &str, age_h: i64, tier: Tier, title: &str) -> CorrelationItem {
        CorrelationItem {
            external_id: id.to_string(),
            iso_a2: iso.to_string(),
            published_at: 1_000_000_000_000 - age_h * 3_600_000,
            tier,
            tokens: title_tokens(title),
        }
    }

    #[test]
    fn similar_same_region_correlate() {
        let items = vec![
            item(
                "a",
                "UA",
                0,
                Tier::Red,
                "Kyiv reports large drone barrage overnight",
            ),
            item(
                "b",
                "UA",
                1,
                Tier::Amber,
                "Ukraine confirms large overnight drone barrage on Kyiv",
            ),
        ];
        let r = correlate(&items);
        assert_eq!(
            r.event_keys[0], r.event_keys[1],
            "should share one event key"
        );
        // Tier escalates to the max (red).
        assert_eq!(r.event_tier[&r.event_keys[0]], Tier::Red);
    }

    // Regression for the per-cycle fragmentation bug: the eventKey now derives
    // from the cluster's CONSENSUS tokens (the story's core terms), not the
    // in-batch min externalId — so it is order-invariant AND a corroborating
    // article that shares the core does not mint a new event key.
    #[test]
    fn event_key_survives_corroborating_additions_and_order() {
        let a = item("x1", "SD", 0, Tier::Black, "RSF shelling around El Fasher kills dozens");
        let b = item("x2", "SD", 1, Tier::Red, "El Fasher shelling by RSF cuts aid routes");
        let c = item("x3", "SD", 2, Tier::Black, "RSF shelling of El Fasher intensifies sharply");
        let k_abc = correlate(&[a.clone(), b.clone(), c.clone()]).event_keys[0].clone();
        // Order-invariant.
        let k_shuf = correlate(&[c.clone(), a.clone(), b.clone()]).event_keys[0].clone();
        assert_eq!(k_abc, k_shuf, "eventKey must be order-invariant");
        // A 4th corroborating article sharing the core terms keeps the SAME key.
        let d = item("x4", "SD", 3, Tier::Red, "RSF shelling near El Fasher displaces thousands");
        let r = correlate(&[a, b, c, d]);
        assert!(
            r.event_keys.iter().all(|k| *k == k_abc),
            "a corroborating article must keep the existing eventKey, not fragment the event"
        );
    }

    #[test]
    fn dissimilar_do_not_correlate() {
        let items = vec![
            item(
                "a",
                "UA",
                0,
                Tier::Red,
                "Kyiv reports large drone barrage overnight",
            ),
            item(
                "b",
                "UA",
                1,
                Tier::Amber,
                "Central bank holds interest rates steady",
            ),
        ];
        let r = correlate(&items);
        assert_ne!(r.event_keys[0], r.event_keys[1]);
    }

    #[test]
    fn different_region_does_not_correlate() {
        let items = vec![
            item(
                "a",
                "UA",
                0,
                Tier::Red,
                "Massive drone barrage strikes capital overnight",
            ),
            item(
                "b",
                "PL",
                1,
                Tier::Red,
                "Massive drone barrage strikes capital overnight",
            ),
        ];
        let r = correlate(&items);
        assert_ne!(
            r.event_keys[0], r.event_keys[1],
            "different regions must not merge"
        );
    }

    #[test]
    fn outside_window_does_not_correlate() {
        let items = vec![
            item(
                "a",
                "UA",
                0,
                Tier::Red,
                "Massive drone barrage strikes capital overnight",
            ),
            item(
                "b",
                "UA",
                200,
                Tier::Red,
                "Massive drone barrage strikes capital overnight",
            ),
        ];
        let r = correlate_with(&items, CORRELATION_WINDOW_MS);
        assert_ne!(
            r.event_keys[0], r.event_keys[1],
            "200h apart exceeds 72h window"
        );
    }

    #[test]
    fn event_key_is_stable_regardless_of_order() {
        let a = item(
            "a",
            "UA",
            0,
            Tier::Red,
            "Kyiv reports large drone barrage overnight",
        );
        let b = item(
            "b",
            "UA",
            1,
            Tier::Amber,
            "Ukraine confirms large overnight drone barrage on Kyiv",
        );
        let r1 = correlate(&[a.clone(), b.clone()]);
        let r2 = correlate(&[b, a]);
        // Both runs anchor on min externalId "a" → identical key.
        assert_eq!(r1.event_keys[0], r2.event_keys[1]);
    }
}
