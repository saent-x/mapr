//! Event correlation: cluster articles into events by title token-set Jaccard
//! AND shared region within a time window, then assign a stable `eventKey`.
//!
//! Two articles correlate when: same ISO region, |Δ publishedAt| ≤ window
//! (default 72h), and token Jaccard ≥ 0.25. Single-link clustering: an article
//! joins the first cluster containing any member it correlates with. The event
//! tier escalates to the highest contributing article tier (the Convex side
//! recomputes the authoritative event, but we pre-assign so a batch is coherent).

use std::collections::HashMap;

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
        // Stable anchor: lexicographically smallest externalId in the cluster.
        let anchor = cluster
            .iter()
            .map(|&i| items[i].external_id.as_str())
            .min()
            .unwrap_or("");
        let region = items[cluster[0]].iso_a2.to_lowercase();
        let region = if region.is_empty() {
            "xx".to_string()
        } else {
            region
        };
        let key = format!("evt-{}-{}", region, hash8(anchor));

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
