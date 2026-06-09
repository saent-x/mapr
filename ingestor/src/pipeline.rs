//! Enrichment pipeline: raw items → dedupe → geocode → severity/category →
//! velocity bump → correlate (eventKey) → embed → `Article` batch.
//!
//! `enrich` is pure and unit-tested (no network, no embedder). `run_cycle`
//! drives one full fetch→pipeline→write iteration against Convex.

use std::time::Duration;

use anyhow::{Context, Result};
use tracing::{info, warn};

use crate::convex::{ConvexClient, HealthStatus, IngestStats};
use crate::correlate::{self, CorrelationItem};
use crate::dedup;
use crate::embed::{OllamaEmbedder, EMBED_DIM};
use crate::fetch;
use crate::geocode;
use crate::model::{Article, RawItem, Tier};
use crate::ner;
use crate::severity;
use crate::velocity::Velocity;

/// Embedding batch size (kept modest to bound memory on CPU embedding).
const EMBED_CHUNK: usize = 32;

/// Max sources fetched concurrently (bounded worker pool over the catalog).
const FETCH_CONCURRENCY: usize = 8;

/// An enriched article awaiting an embedding.
#[derive(Debug, Clone)]
pub struct Draft {
    pub external_id: String,
    pub event_key: String,
    pub title: String,
    pub summary: String,
    pub source: String,
    pub url: Option<String>,
    pub iso_a2: String,
    pub lon: f64,
    pub lat: f64,
    pub severity: f64,
    pub tier: Tier,
    pub category: String,
    pub published_at: i64,
    pub entities: Vec<String>,
    pub image_url: Option<String>,
    /// Stable hex hash of `title + "\n" + summary` (see [`dedup::content_hash`]).
    pub content_hash: String,
}

impl Draft {
    /// Text fed to the embedder (title + summary).
    fn embed_text(&self) -> String {
        if self.summary.is_empty() {
            self.title.clone()
        } else {
            format!("{} {}", self.title, self.summary)
        }
    }
}

/// Enrich raw items into drafts: dedupe, geocode (drop unlocated), score
/// severity with a velocity bump, classify category, and correlate eventKeys.
pub fn enrich(raw: Vec<RawItem>, now: i64) -> Vec<Draft> {
    let deduped = dedup::dedupe(raw);

    // Pass 1: geocode + base severity/category. Unlocated items are dropped
    // (they cannot be placed on the map and would over-cluster region "").
    struct Stage1 {
        external_id: String,
        title: String,
        summary: String,
        source: String,
        url: Option<String>,
        iso_a2: String,
        lon: f64,
        lat: f64,
        base_severity: f64,
        category: String,
        published_at: i64,
        entities: Vec<String>,
        image_url: Option<String>,
    }
    let mut stage1: Vec<Stage1> = Vec::new();
    for item in deduped {
        let geo = match geocode::resolve_salient(&item.title, &item.summary) {
            Some(g) => g,
            None => match item.source_country.as_deref().and_then(geocode::geo_for_iso) {
                Some(g) => g,
                None => continue,
            },
        };
        let category = severity::categorize(&item.title, &item.summary);
        let base_severity = severity::score(&item.title, &item.summary);
        let entities = ner::extract_entities(&item.title, &item.summary);
        let published_at = if item.published_at > 0 {
            item.published_at
        } else {
            now
        };
        stage1.push(Stage1 {
            external_id: dedup::external_id(item.url.as_deref(), &item.title),
            title: item.title,
            summary: item.summary,
            source: item.source,
            url: item.url,
            iso_a2: geo.iso_a2.to_string(),
            lon: geo.lon,
            lat: geo.lat,
            base_severity,
            category,
            published_at,
            entities,
            image_url: item.image_url,
        });
    }

    // Pass 2: velocity bump from (category, region) volume across the batch.
    let velocity = Velocity::from_pairs(
        stage1
            .iter()
            .map(|s| (s.category.as_str(), s.iso_a2.as_str())),
    );

    let mut drafts: Vec<Draft> = stage1
        .into_iter()
        .map(|s| {
            let severity =
                (s.base_severity + velocity.bump(&s.category, &s.iso_a2)).clamp(0.5, 10.0);
            let content_hash = dedup::content_hash(&s.title, &s.summary);
            Draft {
                external_id: s.external_id,
                event_key: String::new(), // filled by correlation
                title: s.title,
                summary: s.summary,
                source: s.source,
                url: s.url,
                iso_a2: s.iso_a2,
                lon: s.lon,
                lat: s.lat,
                severity,
                tier: severity::tier_for(severity),
                category: s.category,
                published_at: s.published_at,
                entities: s.entities,
                image_url: s.image_url,
                content_hash,
            }
        })
        .collect();

    // Pass 3: correlate into events and assign stable eventKeys.
    let corr_items: Vec<CorrelationItem> = drafts
        .iter()
        .map(|d| CorrelationItem {
            external_id: d.external_id.clone(),
            iso_a2: d.iso_a2.clone(),
            published_at: d.published_at,
            tier: d.tier,
            tokens: dedup::title_tokens(&d.title),
        })
        .collect();
    let result = correlate::correlate(&corr_items);
    for (draft, key) in drafts.iter_mut().zip(result.event_keys) {
        draft.event_key = key;
    }

    drafts
}

/// Finalize enriched drafts into contract `Article`s using precomputed
/// embeddings (one per draft, same order). Pure + unit-testable.
pub fn finalize(drafts: Vec<Draft>, vectors: Vec<Vec<f32>>) -> Result<Vec<Article>> {
    anyhow::ensure!(
        vectors.len() == drafts.len(),
        "got {} vectors for {} drafts",
        vectors.len(),
        drafts.len()
    );
    let mut articles = Vec::with_capacity(drafts.len());
    for (d, embedding) in drafts.into_iter().zip(vectors) {
        anyhow::ensure!(
            embedding.len() == EMBED_DIM,
            "embedding must be {EMBED_DIM}-dim, got {}",
            embedding.len()
        );
        articles.push(Article {
            external_id: d.external_id,
            event_key: d.event_key,
            title: d.title,
            summary: d.summary,
            source: d.source,
            url: d.url,
            iso_a2: d.iso_a2,
            lon: d.lon,
            lat: d.lat,
            tier: d.tier,
            severity: d.severity,
            category: d.category,
            published_at: d.published_at,
            entities: d.entities,
            image_url: d.image_url,
            content_hash: d.content_hash,
            embedding,
        });
    }
    Ok(articles)
}

/// Drop drafts whose content is unchanged from what Convex already stores.
///
/// Queries `articles:contentHashesByExternalIds` for the batch's external ids
/// and keeps only drafts that are new (no stored hash) or changed (stored hash
/// differs). On ANY error the query is treated as unavailable and ALL drafts are
/// kept (the optimization must never break a cycle). Returns `(kept, skipped)`.
async fn skip_unchanged(convex: &ConvexClient, drafts: Vec<Draft>) -> (Vec<Draft>, usize) {
    if drafts.is_empty() {
        return (drafts, 0);
    }
    let ids: Vec<String> = drafts.iter().map(|d| d.external_id.clone()).collect();
    let existing = match convex.content_hashes_by_external_ids(&ids).await {
        Ok(map) => map,
        Err(e) => {
            warn!(error = %e, "contentHashesByExternalIds unavailable; embedding all drafts");
            return (drafts, 0);
        }
    };
    let before = drafts.len();
    let kept: Vec<Draft> = drafts
        .into_iter()
        .filter(|d| {
            // Keep when new (no stored hash) or changed (hashes differ).
            match existing.get(&d.external_id) {
                Some(Some(stored)) => stored != &d.content_hash,
                _ => true,
            }
        })
        .collect();
    let skipped = before - kept.len();
    (kept, skipped)
}

/// Embed drafts in bounded chunks and ingest each successful chunk IMMEDIATELY.
///
/// `ingestBatch` is idempotent and chunk-safe, so writing per-chunk means one
/// chunk's embedding failure (e.g. a transient Ollama error) only loses that
/// chunk — the rest of the cycle's articles still land. Failed chunks are logged
/// and skipped, never aborting the cycle. Returns the aggregated ingest stats
/// plus counts of embedded/failed chunks.
async fn embed_and_ingest(
    convex: &ConvexClient,
    embedder: &OllamaEmbedder,
    drafts: Vec<Draft>,
) -> (IngestStats, usize, usize, usize) {
    let mut stats = IngestStats::default();
    let mut ingested = 0usize;
    let mut ok_chunks = 0usize;
    let mut failed_chunks = 0usize;

    for chunk in drafts.chunks(EMBED_CHUNK) {
        let texts: Vec<String> = chunk.iter().map(Draft::embed_text).collect();
        let vectors = match embedder.embed(&texts).await {
            Ok(v) => v,
            Err(e) => {
                failed_chunks += 1;
                warn!(error = %e, size = chunk.len(), "embedding chunk failed; skipping");
                continue;
            }
        };
        let articles = match finalize(chunk.to_vec(), vectors) {
            Ok(a) => a,
            Err(e) => {
                failed_chunks += 1;
                warn!(error = %e, size = chunk.len(), "finalizing chunk failed; skipping");
                continue;
            }
        };
        match convex.ingest_batch(&articles).await {
            Ok(s) => {
                stats.inserted += s.inserted;
                stats.updated += s.updated;
                stats.events += s.events;
                ingested += articles.len();
                ok_chunks += 1;
            }
            Err(e) => {
                failed_chunks += 1;
                warn!(error = %e, size = articles.len(), "ingest chunk failed; skipping");
            }
        }
    }
    (stats, ingested, ok_chunks, failed_chunks)
}

/// Outcome of one ingest cycle.
#[derive(Debug, Default, Clone, Copy)]
pub struct CycleReport {
    pub sources: usize,
    pub raw_items: usize,
    pub articles: usize,
    pub stats: IngestStats,
}

/// Fetch every source concurrently (bounded pool), reporting per-source health
/// and isolating failures (one bad source logs + skips, never aborting). Items
/// inherit the source's configured region when they carry no `source_country`.
async fn fetch_all(
    http: &reqwest::Client,
    convex: &ConvexClient,
    sources: &[crate::model::Source],
    fetch_timeout: Duration,
) -> Vec<RawItem> {
    use futures_util::stream::{self, StreamExt};

    // Bounded concurrent fetch: each task returns its source + fetch result so
    // health reporting and region fallback run after the fetch completes.
    let fetched: Vec<(&crate::model::Source, Result<Vec<RawItem>>)> = stream::iter(sources.iter())
        .map(|source| async move {
            let result = fetch::fetch_source_retrying(http, source, fetch_timeout).await;
            (source, result)
        })
        .buffer_unordered(FETCH_CONCURRENCY)
        .collect()
        .await;

    let mut raw: Vec<RawItem> = Vec::new();
    for (source, result) in fetched {
        match result {
            Ok(mut items) => {
                let n = items.len() as u64;
                info!(source = %source.name, items = n, "fetched source");
                let status = if n == 0 {
                    HealthStatus::Warn
                } else {
                    HealthStatus::Ok
                };
                if let Err(e) = convex
                    .report_source_health(&source.url, status, None, n)
                    .await
                {
                    warn!(source = %source.name, error = %e, "report health failed");
                }
                // Carry the source's configured region onto items lacking a
                // source_country (GDELT items already have one and keep theirs)
                // so unlocated text can fall back to the source's home country.
                for it in &mut items {
                    if it.source_country.is_none() {
                        it.source_country = source.region.clone();
                    }
                }
                raw.extend(items);
            }
            Err(e) => {
                warn!(source = %source.name, error = %e, "fetch failed");
                let _ = convex
                    .report_source_health(&source.url, HealthStatus::Err, Some(&e.to_string()), 0)
                    .await;
            }
        }
    }
    raw
}

/// Run one fetch → enrich → embed → write cycle.
pub async fn run_cycle(
    http: &reqwest::Client,
    convex: &ConvexClient,
    embedder: &OllamaEmbedder,
    fetch_timeout: Duration,
) -> Result<CycleReport> {
    let sources = convex.list_sources().await.context("listing sources")?;
    info!(count = sources.len(), "fetched source catalog");

    let raw = fetch_all(http, convex, &sources, fetch_timeout).await;

    let raw_items = raw.len();
    let now = now_ms();
    let drafts = enrich(raw, now);
    let enriched = drafts.len();

    // Skip drafts whose content is unchanged in the corpus (safe fallback: keep
    // all on query error), then embed + ingest the rest INCREMENTALLY so one bad
    // chunk can't discard the whole cycle.
    let (drafts, skipped) = skip_unchanged(convex, drafts).await;
    let (stats, ingested, ok_chunks, failed_chunks) =
        embed_and_ingest(convex, embedder, drafts).await;
    info!(
        enriched,
        skipped_unchanged = skipped,
        ingested,
        ok_chunks,
        failed_chunks,
        "embedded + ingested"
    );

    Ok(CycleReport {
        sources: sources.len(),
        raw_items,
        articles: ingested,
        stats,
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::embed::dummy_vector;

    fn raw(title: &str, summary: &str, url: &str, ts: i64) -> RawItem {
        RawItem {
            title: title.to_string(),
            summary: summary.to_string(),
            url: Some(url.to_string()),
            source: "Test".to_string(),
            published_at: ts,
            source_country: None,
            image_url: None,
        }
    }

    #[test]
    fn enrich_geocodes_scores_and_correlates() {
        let now = 1_700_000_000_000;
        let items = vec![
            raw(
                "Kyiv reports large drone barrage overnight",
                "Air defenses engaged dozens of drones over Kyiv.",
                "https://a.com/1",
                now - 1_000,
            ),
            raw(
                "Ukraine confirms large overnight drone barrage on Kyiv",
                "General staff confirms interception.",
                "https://b.com/2",
                now - 2_000,
            ),
            raw(
                "Tokyo stock market rallies on tech earnings",
                "Equities rose sharply in Tokyo.",
                "https://c.com/3",
                now - 3_000,
            ),
        ];
        let drafts = enrich(items, now);
        assert_eq!(drafts.len(), 3, "all located, none dropped");

        let kyiv: Vec<_> = drafts.iter().filter(|d| d.iso_a2 == "UA").collect();
        assert_eq!(kyiv.len(), 2);
        assert_eq!(kyiv[0].category, "conflict");
        // The two Kyiv drone stories correlate into one event.
        assert_eq!(kyiv[0].event_key, kyiv[1].event_key);

        let tokyo: Vec<_> = drafts.iter().filter(|d| d.iso_a2 == "JP").collect();
        assert_eq!(tokyo.len(), 1);
        assert_ne!(tokyo[0].event_key, kyiv[0].event_key);
    }

    #[test]
    fn enrich_drops_unlocated() {
        let now = 1_700_000_000_000;
        let items = vec![raw(
            "Council approves new park bench design",
            "",
            "https://x.com/1",
            now,
        )];
        assert!(enrich(items, now).is_empty());
    }

    #[test]
    fn enrich_falls_back_to_source_country_region() {
        let now = 1_700_000_000_000;
        // Non-geocoding text + a real country iso region → placed in that country.
        let mut item = raw("Local council meets", "", "https://y.com/1", now);
        item.source_country = Some("MR".to_string());
        let drafts = enrich(vec![item], now);
        assert_eq!(drafts.len(), 1, "fallback places the item");
        assert_eq!(drafts[0].iso_a2, "MR");

        // Same text with a macro-region token → no country → dropped.
        let mut macro_item = raw("Local council meets", "", "https://y.com/2", now);
        macro_item.source_country = Some("AFRICA".to_string());
        assert!(
            enrich(vec![macro_item], now).is_empty(),
            "macro region token does not resolve to a country"
        );
    }

    #[test]
    fn finalize_produces_contract_articles() {
        let now = 1_700_000_000_000;
        let items = vec![raw(
            "Earthquake strikes off Tokyo coast",
            "A magnitude 6 quake was recorded.",
            "https://a.com/1",
            now,
        )];
        let drafts = enrich(items, now);
        let vectors: Vec<Vec<f32>> = drafts
            .iter()
            .enumerate()
            .map(|(i, _)| dummy_vector(i as f32))
            .collect();
        let articles = finalize(drafts, vectors).unwrap();
        assert_eq!(articles.len(), 1);
        let a = &articles[0];
        assert_eq!(a.embedding.len(), EMBED_DIM);
        assert_eq!(a.iso_a2, "JP");
        assert_eq!(a.category, "seismic");
        assert!(a.external_id.starts_with("art-"));
        assert!(a.event_key.starts_with("evt-jp-"));
    }
}
