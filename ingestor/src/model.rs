//! Shared domain types for the ingestion pipeline and Convex writer.
//!
//! `Source` mirrors `ingest:listSources`; `Article` mirrors the `ingestBatch`
//! article input (camelCase JSON, `tier` lowercase, `embedding` as JSON floats).

use serde::{ser::SerializeSeq, Deserialize, Serialize, Serializer};

/// Source kind as stored in the Convex `sourceCatalog`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Gdelt,
    Rss,
    Html,
    Bluesky,
}

/// An enabled source returned by `ingest:listSources`.
#[derive(Debug, Clone, Deserialize)]
pub struct Source {
    pub id: String,
    pub name: String,
    pub url: String,
    pub kind: SourceKind,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
}

/// A raw item produced by a fetcher, before enrichment.
#[derive(Debug, Clone)]
pub struct RawItem {
    pub title: String,
    pub summary: String,
    pub url: Option<String>,
    pub source: String,
    /// ms epoch; 0 when the feed gave no usable timestamp (caller fills `now`).
    pub published_at: i64,
    /// Optional ISO/FIPS source-country hint (GDELT `sourcecountry`).
    pub source_country: Option<String>,
    pub image_url: Option<String>,
}

/// Severity tier. Maps a 0..10 severity score; serialized lowercase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Green,
    Amber,
    Red,
    Black,
}

impl Tier {
    /// Ordinal used to escalate an event to its highest contributing tier.
    pub fn rank(self) -> u8 {
        match self {
            Tier::Green => 1,
            Tier::Amber => 2,
            Tier::Red => 3,
            Tier::Black => 4,
        }
    }
}

/// A fully enriched article ready for `ingest:ingestBatch`.
///
/// Field names + casing match the Convex `articleInput` validator exactly.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Article {
    pub external_id: String,
    pub event_key: String,
    pub title: String,
    pub summary: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub iso_a2: String,
    pub lon: f64,
    pub lat: f64,
    pub tier: Tier,
    pub severity: f64,
    pub category: String,
    pub published_at: i64,
    pub entities: Vec<String>,
    /// Stable hex hash of `title + "\n" + summary`. Lets the backend skip
    /// re-embedding unchanged articles (see `articles:contentHashesByExternalIds`).
    pub content_hash: String,
    /// EXACTLY 1024 bge-m3 floats, L2-normalized. Serialized at 6 significant
    /// figures (see [`serialize_embedding`]) to keep the stored row compact.
    #[serde(serialize_with = "serialize_embedding")]
    pub embedding: Vec<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
}

/// Serialize a bge-m3 embedding as 6-significant-figure decimals.
///
/// serde promotes each `f32` to `f64` at the JSON boundary, so the default
/// output is the full ~17-digit expansion of the `f32` — ~21 KB for a 1024-dim
/// vector, roughly 97% of an article row and the bulk of total storage. Six
/// significant figures sit well inside `f32`'s ~7 digits of real precision, so
/// cosine similarity shifts by < 1e-5 (retrieval ranking is unaffected) while
/// the serialized vector shrinks by ~45%.
fn serialize_embedding<S: Serializer>(v: &[f32], s: S) -> Result<S::Ok, S::Error> {
    let mut seq = s.serialize_seq(Some(v.len()))?;
    for &x in v {
        seq.serialize_element(&round_sig6(x))?;
    }
    seq.end()
}

/// Round to 6 significant figures, returning the value as `f64` so serde emits
/// the short decimal (e.g. `-0.0246736`) rather than the f32's full expansion.
fn round_sig6(x: f32) -> f64 {
    if x == 0.0 || !x.is_finite() {
        return x as f64;
    }
    let x = x as f64;
    let factor = 10f64.powi(5 - x.abs().log10().floor() as i32);
    (x * factor).round() / factor
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Serialize, Deserialize)]
    struct EmbWrap {
        #[serde(serialize_with = "serialize_embedding")]
        e: Vec<f32>,
    }

    #[test]
    fn article_serializes_content_hash_as_camel_case() {
        // The Convex `ingestBatch` validator + `contentHashesByExternalIds`
        // contract expect `contentHash` (camelCase). Lock the field name.
        let article = Article {
            external_id: "art-x".into(),
            event_key: "evt-x".into(),
            title: "T".into(),
            summary: "S".into(),
            source: "src".into(),
            url: None,
            iso_a2: "UA".into(),
            lon: 30.0,
            lat: 50.0,
            tier: Tier::Red,
            severity: 7.0,
            category: "conflict".into(),
            published_at: 1,
            entities: vec![],
            content_hash: "deadbeef".into(),
            embedding: crate::embed::dummy_vector(0.1),
            image_url: None,
        };
        let json = serde_json::to_value(&article).unwrap();
        assert_eq!(json["contentHash"], "deadbeef");
        assert!(json.get("content_hash").is_none(), "must be camelCase only");
    }

    #[test]
    fn round_sig6_keeps_six_figures() {
        assert!((round_sig6(-0.024_673_635) - -0.024_673_6).abs() < 1e-12);
        assert_eq!(round_sig6(0.0), 0.0);
        assert!((round_sig6(0.15) - 0.15).abs() < 1e-12);
    }

    #[test]
    fn embedding_serializes_compactly_and_accurately() {
        let v = crate::embed::dummy_vector(0.3);
        let rounded = serde_json::to_string(&EmbWrap { e: v.clone() }).unwrap();
        let fat =
            serde_json::to_string(&v.iter().map(|x| *x as f64).collect::<Vec<f64>>()).unwrap();
        // Full-precision f64 is the status quo; rounding must cut it materially.
        assert!(
            rounded.len() * 10 < fat.len() * 7,
            "expected >30% smaller: rounded={} fat={}",
            rounded.len(),
            fat.len()
        );
        // Round-trips back to within 6-sig-fig tolerance of the source vector.
        let back: EmbWrap = serde_json::from_str(&rounded).unwrap();
        assert_eq!(back.e.len(), v.len());
        let max_diff = v
            .iter()
            .zip(&back.e)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(max_diff < 1e-4, "max abs diff {max_diff}");
    }
}
