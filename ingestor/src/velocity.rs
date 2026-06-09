//! Velocity tracker: recent article counts per (category, region) used to bump
//! severity when a region/category is spiking. A surge of independent reports is
//! itself a severity signal (port of the intent behind `server/velocityTracker.js`).

use std::collections::HashMap;

/// Counts of recent articles keyed by `(category, isoA2)`.
#[derive(Debug, Default)]
pub struct Velocity {
    counts: HashMap<(String, String), usize>,
}

impl Velocity {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record one article occurrence for a (category, region).
    pub fn record(&mut self, category: &str, region: &str) {
        *self
            .counts
            .entry((category.to_string(), region.to_string()))
            .or_insert(0) += 1;
    }

    /// Build a tracker from an iterator of (category, region) pairs.
    pub fn from_pairs<'a>(pairs: impl IntoIterator<Item = (&'a str, &'a str)>) -> Self {
        let mut v = Self::new();
        for (c, r) in pairs {
            v.record(c, r);
        }
        v
    }

    /// Current count for a (category, region).
    pub fn count(&self, category: &str, region: &str) -> usize {
        self.counts
            .get(&(category.to_string(), region.to_string()))
            .copied()
            .unwrap_or(0)
    }

    /// Severity bump for the given (category, region) based on recent volume.
    /// A handful of corroborating reports => small bump; a flood => larger,
    /// capped so velocity can never alone push routine news into a crisis tier.
    pub fn bump(&self, category: &str, region: &str) -> f64 {
        match self.count(category, region) {
            0..=2 => 0.0,
            3..=4 => 0.5,
            5..=9 => 1.0,
            _ => 1.5,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_accumulate_per_key() {
        let mut v = Velocity::new();
        v.record("conflict", "UA");
        v.record("conflict", "UA");
        v.record("conflict", "IL");
        assert_eq!(v.count("conflict", "UA"), 2);
        assert_eq!(v.count("conflict", "IL"), 1);
        assert_eq!(v.count("cyber", "UA"), 0);
    }

    #[test]
    fn from_pairs_builds_counts() {
        let v = Velocity::from_pairs([("weather", "AU"), ("weather", "AU"), ("weather", "AU")]);
        assert_eq!(v.count("weather", "AU"), 3);
    }

    #[test]
    fn bump_is_tiered_and_capped() {
        let mut v = Velocity::new();
        assert_eq!(v.bump("conflict", "UA"), 0.0); // 0
        v.record("conflict", "UA");
        v.record("conflict", "UA");
        assert_eq!(v.bump("conflict", "UA"), 0.0); // 2
        v.record("conflict", "UA");
        assert_eq!(v.bump("conflict", "UA"), 0.5); // 3
        for _ in 0..2 {
            v.record("conflict", "UA");
        }
        assert_eq!(v.bump("conflict", "UA"), 1.0); // 5
        for _ in 0..20 {
            v.record("conflict", "UA");
        }
        assert_eq!(v.bump("conflict", "UA"), 1.5); // capped
    }
}
