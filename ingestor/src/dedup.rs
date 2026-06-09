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

/// Stable content hash of `title + "\n" + summary` (full sha256 hex). Used to
/// skip re-embedding unchanged articles; identical for byte-identical content
/// across cycles. Matches the Convex `articles:contentHashesByExternalIds`
/// contract.
pub fn content_hash(title: &str, summary: &str) -> String {
    sha_hex(&format!("{title}\n{summary}"))
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
    jaccard_sets(&lset, &rset)
}

/// Jaccard over precomputed token sets (avoids rebuilding the HashSets per
/// comparison in the blocked phase-2 loop).
fn jaccard_sets(
    left: &std::collections::HashSet<&String>,
    right: &std::collections::HashSet<&String>,
) -> f64 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let inter = left.iter().filter(|t| right.contains(**t)).count();
    let union = left.len() + right.len() - inter;
    if union == 0 {
        0.0
    } else {
        inter as f64 / union as f64
    }
}

/// Stable 64-bit FNV-1a hash of a token, for deterministic MinHash band keys.
fn token_hash(token: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in token.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// Number of smallest-hash tokens used as MinHash band keys per item. Two titles
/// above [`NEAR_DUP_THRESHOLD`] Jaccard overwhelmingly share at least one of
/// these, so bucketing on them never misses a real near-duplicate while pruning
/// the O(n^2) comparison set to within-bucket candidates.
const BAND_KEYS: usize = 3;

/// The up-to-[`BAND_KEYS`] smallest token hashes for `tokens` (its blocking keys).
fn band_keys(tokens: &[String]) -> Vec<u64> {
    let mut hashes: Vec<u64> = tokens.iter().map(|t| token_hash(t)).collect();
    hashes.sort_unstable();
    hashes.dedup();
    hashes.truncate(BAND_KEYS);
    hashes
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

    // Phase 2: title-similarity dedup across sources, BLOCKED by MinHash band
    // keys. Instead of comparing each item against every kept item (O(n^2)), we
    // bucket kept items by their smallest token hashes and only run Jaccard
    // against candidates sharing a band key. Token sets are precomputed once.
    use std::collections::{HashMap, HashSet};

    let mut result: Vec<RawItem> = Vec::with_capacity(url_deduped.len());
    // Parallel to `result`: each kept item's tokens (for Jaccard candidates).
    let mut token_cache: Vec<Vec<String>> = Vec::with_capacity(url_deduped.len());
    // band key -> indices into `token_cache`/`result` of kept items in that bucket.
    let mut buckets: HashMap<u64, Vec<usize>> = HashMap::new();

    for item in url_deduped {
        let tokens = title_tokens(&item.title);
        let keys = band_keys(&tokens);
        if tokens.len() >= MIN_TOKENS {
            // Gather candidate kept-item indices from this item's band buckets.
            let tset: HashSet<&String> = tokens.iter().collect();
            let mut candidates: HashSet<usize> = HashSet::new();
            for k in &keys {
                if let Some(idxs) = buckets.get(k) {
                    candidates.extend(idxs.iter().copied());
                }
            }
            let dup = candidates.iter().any(|&idx| {
                let cached = &token_cache[idx];
                if cached.len() < MIN_TOKENS {
                    return false;
                }
                let cset: HashSet<&String> = cached.iter().collect();
                jaccard_sets(&tset, &cset) >= NEAR_DUP_THRESHOLD
            });
            if dup {
                continue;
            }
        }
        let idx = result.len();
        for k in &keys {
            buckets.entry(*k).or_default().push(idx);
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
    fn content_hash_is_stable_and_content_sensitive() {
        let a = content_hash("Title", "Summary");
        let b = content_hash("Title", "Summary");
        assert_eq!(a, b, "identical content hashes identically");
        assert_ne!(
            a,
            content_hash("Title", "Summary changed"),
            "changed summary changes the hash"
        );
        assert_ne!(
            a,
            content_hash("Other", "Summary"),
            "changed title changes the hash"
        );
        // Field boundary is part of the hash basis (title+\n+summary), so the
        // split between title and summary is significant.
        assert_ne!(content_hash("ab", "c"), content_hash("a", "bc"));
        assert_eq!(a.len(), 64, "full sha256 hex");
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

    #[test]
    fn band_keys_collide_for_near_duplicates() {
        // Near-duplicate titles share most tokens, so they share at least one
        // MinHash band key (land in the same bucket). Unrelated titles do not.
        let a = title_tokens("Massive earthquake strikes coastal city killing dozens");
        let b = title_tokens("Massive earthquake strikes coastal city killing dozens of people");
        let c = title_tokens("Central bank holds interest rates steady amid inflation");
        let ka = band_keys(&a);
        let kb = band_keys(&b);
        let kc = band_keys(&c);
        assert!(
            ka.iter().any(|k| kb.contains(k)),
            "near-dups must share a band key"
        );
        assert!(
            !ka.iter().any(|k| kc.contains(k)),
            "unrelated titles must not share a band key"
        );
    }

    #[test]
    fn blocked_dedupe_collapses_dups_and_keeps_unrelated() {
        // Two near-duplicates that land in the same MinHash bucket still
        // collapse; two unrelated stories both survive. (Regression guard for
        // the blocked phase-2 path.)
        let items = vec![
            item(
                "Severe flooding displaces thousands across northern province",
                Some("https://a.com/1"),
                "S1",
            ),
            item(
                "Severe flooding displaces thousands across the northern province today",
                Some("https://b.com/2"),
                "S2",
            ),
            item(
                "Tech giant unveils new flagship smartphone lineup",
                Some("https://c.com/3"),
                "S3",
            ),
        ];
        let out = dedupe(items);
        assert_eq!(out.len(), 2, "near-dup collapsed, unrelated kept: {:?}", out.iter().map(|i| &i.title).collect::<Vec<_>>());
        assert!(out.iter().any(|i| i.title.contains("flooding")));
        assert!(out.iter().any(|i| i.title.contains("smartphone")));
    }
}
