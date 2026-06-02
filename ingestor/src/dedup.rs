//! Deduplication: stable `externalId` derivation + near-duplicate detection.
//!
//! - `external_id` = `"art-" + sha256(canonical_url)` (or normalized title when
//!   no URL), giving an idempotent upsert key across re-runs.
//! - `canonicalize_url` strips scheme/`www.`/tracking params/trailing slash and
//!   sorts the remaining query — ported from `articleUtils.js#normalizeUrl`.
//! - Near-duplicate detection uses title-token Jaccard (threshold 0.65, the JS
//!   `TITLE_SIMILARITY_THRESHOLD`).

use sha2::{Digest, Sha256};
use url::Url;

use crate::model::RawItem;

/// Tracking query params that are pure attribution noise (stripped from the
/// dedup key). Mirrors `articleUtils.js#TRACKING_PARAM_PATTERNS`.
fn is_tracking_param(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.starts_with("utm_")
        || n == "fbclid"
        || n == "gclid"
        || n == "msclkid"
        || n == "mc_cid"
        || n == "mc_eid"
        || n == "_ga"
        || n == "igshid"
        || n == "ref"
        || n == "ref_src"
        || n == "ref_url"
        || n == "s_cid"
        || n == "s_kwcid"
        || n == "yclid"
}

/// Canonicalize a URL into a stable dedup string: `host/path?sortedquery`.
/// Falls back to a lightweight string normalization for unparseable input.
pub fn canonicalize_url(raw: &str) -> String {
    let Ok(parsed) = Url::parse(raw) else {
        return raw
            .to_lowercase()
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_start_matches("www.")
            .trim_end_matches('/')
            .split('#')
            .next()
            .unwrap_or("")
            .to_string();
    };
    let host = parsed.host_str().unwrap_or("").to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    let path = parsed.path().trim_end_matches('/');
    let path = if path.is_empty() { "/" } else { path };
    let mut params: Vec<(String, String)> = parsed
        .query_pairs()
        .filter(|(k, _)| !is_tracking_param(k))
        .map(|(k, v)| (k.to_lowercase(), v.to_string()))
        .collect();
    params.sort();
    let query = if params.is_empty() {
        String::new()
    } else {
        let joined: Vec<String> = params.iter().map(|(k, v)| format!("{k}={v}")).collect();
        format!("?{}", joined.join("&"))
    };
    format!("{host}{path}{query}")
}

/// Normalize a title for use as a fallback dedup key.
fn normalize_title(title: &str) -> String {
    let cleaned: String = title
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c.is_whitespace() {
                c
            } else {
                ' '
            }
        })
        .collect();
    cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(80)
        .collect()
}

fn sha_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Stable external id (idempotent upsert key). Uses the canonical URL when
/// present, else the normalized title.
pub fn external_id(url: Option<&str>, title: &str) -> String {
    let basis = match url {
        Some(u) if !u.trim().is_empty() => canonicalize_url(u),
        _ => normalize_title(title),
    };
    format!("art-{}", &sha_hex(&basis)[..24])
}

/// Stop words excluded from title token sets (subset of the JS DEDUP_STOP_WORDS).
const STOP_WORDS: &[&str] = &[
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "near",
    "amid",
    "after",
    "before",
    "over",
    "under",
    "across",
    "new",
    "says",
    "say",
    "report",
    "reports",
    "news",
    "update",
    "updates",
    "officials",
    "official",
    "warns",
    "warning",
    "warn",
    "region",
    "state",
    "province",
    "told",
    "via",
    "also",
    "been",
    "has",
    "have",
    "had",
    "are",
    "were",
    "was",
    "will",
    "can",
    "could",
    "would",
    "should",
    "may",
    "about",
];

/// Tokenize a title into meaningful lowercase tokens (len > 2, non-stopword).
pub fn title_tokens(title: &str) -> Vec<String> {
    let cleaned: String = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { ' ' })
        .collect();
    cleaned
        .split_whitespace()
        .filter(|t| t.len() > 2 && !STOP_WORDS.contains(t))
        .map(|t| t.to_string())
        .collect()
}

/// Jaccard similarity between two token slices (intersection / union).
pub fn jaccard(left: &[String], right: &[String]) -> f64 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let rset: std::collections::HashSet<&String> = right.iter().collect();
    let lset: std::collections::HashSet<&String> = left.iter().collect();
    let inter = lset.iter().filter(|t| rset.contains(**t)).count();
    let union = lset.union(&rset).count();
    if union == 0 {
        0.0
    } else {
        inter as f64 / union as f64
    }
}

/// Minimum Jaccard for two titles to be near-duplicates. Tuned ABOVE the
/// correlation threshold (0.25): dedup removes only true duplicates (truncations
/// / reposts), while distinct same-event articles from different sources survive
/// to corroborate one correlated event.
pub const NEAR_DUP_THRESHOLD: f64 = 0.80;

/// Minimum meaningful tokens before title similarity is considered.
const MIN_TOKENS: usize = 3;

/// Remove near-duplicate items: exact canonical-URL/title dupes first, then
/// cross-source title-Jaccard collapse. Preserves first-seen ordering.
pub fn dedupe(items: Vec<RawItem>) -> Vec<RawItem> {
    // Phase 1: exact key dedup (canonical url, or source::title).
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut url_deduped: Vec<RawItem> = Vec::with_capacity(items.len());
    for item in items {
        let key = match &item.url {
            Some(u) if !u.trim().is_empty() => canonicalize_url(u),
            _ => format!(
                "{}::{}",
                item.source.to_lowercase(),
                normalize_title(&item.title)
            ),
        };
        if key.is_empty() || seen.contains(&key) {
            continue;
        }
        seen.insert(key);
        url_deduped.push(item);
    }

    // Phase 2: title-similarity dedup across sources.
    let mut result: Vec<RawItem> = Vec::with_capacity(url_deduped.len());
    let mut token_cache: Vec<Vec<String>> = Vec::with_capacity(url_deduped.len());
    for item in url_deduped {
        let tokens = title_tokens(&item.title);
        if tokens.len() >= MIN_TOKENS {
            let dup = token_cache.iter().any(|cached| {
                cached.len() >= MIN_TOKENS && jaccard(&tokens, cached) >= NEAR_DUP_THRESHOLD
            });
            if dup {
                continue;
            }
        }
        token_cache.push(tokens);
        result.push(item);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(title: &str, url: Option<&str>, source: &str) -> RawItem {
        RawItem {
            title: title.to_string(),
            summary: title.to_string(),
            url: url.map(|u| u.to_string()),
            source: source.to_string(),
            published_at: 0,
            source_country: None,
            image_url: None,
        }
    }

    #[test]
    fn canonical_url_strips_tracking_and_www_and_sorts() {
        let a = canonicalize_url("https://www.example.com/news/story/?utm_source=x&b=2&a=1");
        assert_eq!(a, "example.com/news/story?a=1&b=2");
    }

    #[test]
    fn external_id_is_stable_and_url_canonical() {
        let id1 = external_id(Some("https://www.example.com/a/?utm_source=foo"), "T");
        let id2 = external_id(Some("http://example.com/a"), "T");
        assert_eq!(
            id1, id2,
            "tracking/scheme/www differences must not change id"
        );
        assert!(id1.starts_with("art-"));
        assert_eq!(id1.len(), 4 + 24);
    }

    #[test]
    fn external_id_falls_back_to_title() {
        let id = external_id(None, "Breaking: Something Happened!");
        let id2 = external_id(Some("   "), "Breaking: Something Happened!");
        assert_eq!(id, id2);
    }

    #[test]
    fn jaccard_basic() {
        let a = title_tokens("Kyiv reports large drone interception overnight");
        let b = title_tokens("Kyiv confirms large drone interception");
        assert!(jaccard(&a, &b) >= 0.5, "got {}", jaccard(&a, &b));
        let c = title_tokens("Tokyo stock market falls sharply");
        assert!(jaccard(&a, &c) < 0.25);
    }

    #[test]
    fn dedupe_collapses_exact_url() {
        let items = vec![
            item("Story A", Some("https://example.com/a"), "S1"),
            item("Story A copy", Some("https://www.example.com/a/"), "S2"),
        ];
        let out = dedupe(items);
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn dedupe_collapses_near_duplicate_titles() {
        let items = vec![
            item(
                "Massive earthquake strikes coastal city killing dozens",
                Some("https://a.com/1"),
                "S1",
            ),
            item(
                "Massive earthquake strikes coastal city killing dozens of people",
                Some("https://b.com/2"),
                "S2",
            ),
        ];
        let out = dedupe(items);
        assert_eq!(out.len(), 1, "near-dup titles should collapse");
    }

    #[test]
    fn dedupe_keeps_distinct_stories() {
        let items = vec![
            item(
                "Earthquake strikes Honshu coast",
                Some("https://a.com/1"),
                "S1",
            ),
            item(
                "Markets rally after inflation report",
                Some("https://b.com/2"),
                "S2",
            ),
        ];
        let out = dedupe(items);
        assert_eq!(out.len(), 2);
    }
}
