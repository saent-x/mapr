//! Keyword-driven severity scoring (0..10) + tier mapping, and category
//! classification into the locked contract set:
//! `conflict|cyber|unrest|seismic|weather|economic|health|maritime|tech`.
//!
//! Ported from `src/utils/articleUtils.js` (`SEVERITY_KEYWORDS` bands +
//! `deriveCategory`), rescaled from the JS 0..100 bands to the contract's
//! 0..10 scale and remapped onto the contract category vocabulary.

use crate::model::Tier;

/// Severity bands (highest first). Each entry is (base_score, keywords).
/// Base scores mirror the JS bands: critical 85→8.5, high 70→7.0,
/// elevated 50→5.0, moderate 35→3.5 (÷10).
const BANDS: &[(f64, &[&str])] = &[
    (
        8.5,
        &[
            "killed",
            "deaths",
            " dead",
            "massacre",
            "bombing",
            "explosion",
            "earthquake",
            "tsunami",
            "hurricane",
            "cyclone",
            "typhoon",
            "famine",
            "genocide",
            "war ",
            "invasion",
            "airstrike",
            "missile",
            "catastroph",
            "devastat",
            "collapse",
            "mass shooting",
            "terror attack",
            "nuclear",
            "wildfire",
            "eruption",
        ],
    ),
    (
        7.0,
        &[
            "crisis",
            "emergency",
            "disaster",
            "flood",
            "drought",
            "epidemic",
            "outbreak",
            "pandemic",
            "conflict",
            "attack",
            "rebel",
            "militant",
            "refugee",
            "displacement",
            "evacuat",
            "casualt",
            "injur",
            "trapped",
            "rescue",
            "severe",
            "urgent",
            "siege",
            "shelling",
            "ransomware",
            "breach",
        ],
    ),
    (
        5.0,
        &[
            "protest",
            "unrest",
            "tension",
            "clashes",
            "strike",
            "riot",
            "sanctions",
            "shortage",
            "blackout",
            "outage",
            "landslide",
            "storm",
            "warning",
            "threat",
            "arrest",
            "detained",
            "violence",
            "corruption",
            "coup",
            "inflation",
            "recession",
            "hack",
            "malware",
        ],
    ),
    (
        3.5,
        &[
            "concern",
            "risk",
            "dispute",
            "debate",
            "rally",
            "march",
            "demand",
            "investigation",
            "allegation",
            "scandal",
            "controversy",
            "delay",
            "disruption",
            "closure",
            "restriction",
            "ban",
        ],
    ),
];

/// Floor score for an article with no severity keyword at all.
const BASELINE: f64 = 2.0;

/// Category keyword sets (ordered: first match wins). Mapped onto the locked
/// contract vocabulary. Order encodes precedence for ambiguous titles.
const CATEGORIES: &[(&str, &[&str])] = &[
    (
        "seismic",
        &[
            "earthquake",
            "tsunami",
            "volcano",
            "eruption",
            "seismic",
            "aftershock",
            "quake",
            "magnitude",
        ],
    ),
    (
        "cyber",
        &[
            "cyber",
            "ransomware",
            "ransom",
            "malware",
            "breach",
            "hack",
            "phishing",
            "ddos",
            "data leak",
            "exploit",
            "zero-day",
            "zero day",
            "spyware",
        ],
    ),
    (
        "maritime",
        &[
            "vessel",
            "tanker",
            "shipping",
            "strait",
            "navy",
            "naval",
            "port ",
            "cargo ship",
            "piracy",
            "pirate",
            "hijack",
            "bab-el-mandeb",
            "red sea",
            "suez",
            "freighter",
        ],
    ),
    (
        "conflict",
        &[
            "war ",
            "warfare",
            "attack",
            "bomb",
            "missile",
            "airstrike",
            "military",
            "army",
            "rebel",
            "militia",
            "militant",
            "terror",
            "shelling",
            "offensive",
            "troops",
            "invasion",
            "insurgent",
            "drone strike",
            "ceasefire",
            "frontline",
        ],
    ),
    (
        "unrest",
        &[
            "protest",
            "riot",
            "demonstration",
            "unrest",
            "clashes",
            "coup",
            "uprising",
            "strike",
            "rally",
            "march",
            "looting",
            "crackdown",
        ],
    ),
    (
        "health",
        &[
            "outbreak",
            "pandemic",
            "epidemic",
            "virus",
            "disease",
            "cholera",
            "ebola",
            "measles",
            "vaccine",
            "infection",
            "hospital",
            "health",
        ],
    ),
    (
        "weather",
        &[
            "flood",
            "storm",
            "hurricane",
            "cyclone",
            "typhoon",
            "tornado",
            "wildfire",
            "drought",
            "heatwave",
            "blizzard",
            "monsoon",
            "landslide",
            "wildfires",
        ],
    ),
    (
        "economic",
        &[
            "inflation",
            "recession",
            "market",
            "gdp",
            "unemployment",
            "debt",
            "currency",
            "sanctions",
            "default",
            "trade war",
            "stocks",
            "bankruptcy",
            "tariff",
        ],
    ),
    (
        "tech",
        &[
            "satellite",
            "semiconductor",
            " chip ",
            "chips",
            "software",
            "data center",
            "artificial intelligence",
            " ai ",
            "outage",
            "internet",
            "blackout",
        ],
    ),
];

/// Default category when no keyword matches. Matches the repo's established
/// crisis-monitoring fallback (`convex/scripts/embed_stub.mjs`).
const DEFAULT_CATEGORY: &str = "conflict";

/// Score an article's title + summary to a severity in `[0.5, 10.0]`.
/// Highest matching band wins; a second keyword in the same-or-higher band
/// adds a small bump so multi-signal headlines outrank single-signal ones.
pub fn score(title: &str, summary: &str) -> f64 {
    let hay = format!("{} {}", title.to_lowercase(), summary.to_lowercase());
    let mut base = BASELINE;
    let mut hits = 0usize;
    'outer: for (band, keywords) in BANDS {
        for kw in *keywords {
            if hay.contains(kw) {
                base = *band;
                // Count additional hits within this band for the bump.
                hits = keywords.iter().filter(|k| hay.contains(**k)).count();
                break 'outer;
            }
        }
    }
    let bump = ((hits.saturating_sub(1)) as f64 * 0.25).min(1.0);
    (base + bump).clamp(0.5, 10.0)
}

/// Map a 0..10 severity score to a tier. Thresholds chosen to reproduce the
/// seed corpus labels (3.2→green, 5.5→amber, 8.2→red; black reserved for ≥9).
pub fn tier_for(severity: f64) -> Tier {
    if severity < 4.0 {
        Tier::Green
    } else if severity < 6.0 {
        Tier::Amber
    } else if severity < 9.0 {
        Tier::Red
    } else {
        Tier::Black
    }
}

/// Classify an article title (and summary fallback) into the contract category set.
pub fn categorize(title: &str, summary: &str) -> String {
    let hay = format!(" {} {} ", title.to_lowercase(), summary.to_lowercase());
    for (cat, keywords) in CATEGORIES {
        if keywords.iter().any(|kw| hay.contains(kw)) {
            return (*cat).to_string();
        }
    }
    DEFAULT_CATEGORY.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn critical_keywords_score_high() {
        let s = score("Dozens killed in airstrike on city", "");
        assert!(s >= 8.5, "expected critical band, got {s}");
        assert_eq!(tier_for(s), Tier::Red); // 8.5 < 9 → red
    }

    #[test]
    fn catastrophic_multi_signal_reaches_black() {
        // Several critical keywords → base 8.5 + bump up to 1.0 → ≥9 → black.
        let s = score(
            "Massacre and bombing: explosion kills dozens, war declared",
            "invasion",
        );
        assert!(s >= 9.0, "expected black-tier score, got {s}");
        assert_eq!(tier_for(s), Tier::Black);
    }

    #[test]
    fn elevated_keywords_score_mid() {
        let s = score("Protest over inflation turns to clashes", "");
        assert!((5.0..6.0).contains(&s) || s >= 5.0, "got {s}");
        assert_eq!(tier_for(s), Tier::Amber);
    }

    #[test]
    fn no_keyword_is_baseline_green() {
        let s = score("Local council approves new park bench design", "");
        assert!(s < 4.0, "got {s}");
        assert_eq!(tier_for(s), Tier::Green);
    }

    #[test]
    fn tier_boundaries() {
        assert_eq!(tier_for(0.0), Tier::Green);
        assert_eq!(tier_for(3.9), Tier::Green);
        assert_eq!(tier_for(4.0), Tier::Amber);
        assert_eq!(tier_for(5.9), Tier::Amber);
        assert_eq!(tier_for(6.0), Tier::Red);
        assert_eq!(tier_for(8.9), Tier::Red);
        assert_eq!(tier_for(9.0), Tier::Black);
        assert_eq!(tier_for(10.0), Tier::Black);
    }

    #[test]
    fn categorize_known_domains() {
        assert_eq!(
            categorize("Magnitude 6.1 earthquake strikes off Honshu", ""),
            "seismic"
        );
        assert_eq!(
            categorize("Ransomware cripples hospital network", ""),
            "cyber"
        );
        assert_eq!(categorize("Tanker hijacked in the Red Sea", ""), "maritime");
        assert_eq!(categorize("Airstrike hits rebel positions", ""), "conflict");
        assert_eq!(categorize("Mass protest grips the capital", ""), "unrest");
        assert_eq!(categorize("Cholera outbreak widens", ""), "health");
        assert_eq!(
            categorize("Severe flooding displaces thousands", ""),
            "weather"
        );
        assert_eq!(
            categorize("Markets slide on inflation surprise", ""),
            "economic"
        );
        assert_eq!(categorize("New semiconductor fab announced", ""), "tech");
    }

    #[test]
    fn categorize_falls_back_to_default() {
        assert_eq!(
            categorize("Council debates park renovation", ""),
            DEFAULT_CATEGORY
        );
    }

    #[test]
    fn seismic_precedes_conflict_for_quake() {
        // "strikes" could read as conflict; seismic ordering wins for a quake.
        assert_eq!(
            categorize("Earthquake strikes near the border", ""),
            "seismic"
        );
    }
}
