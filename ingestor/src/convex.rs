//! Typed client for the Convex raw HTTP function API.
//!
//! Calls `POST {CONVEX_URL}/api/query` and `/api/mutation` with bodies of the
//! form `{"path":"module:fn","args":{...},"format":"json"}` and unwraps the
//! `{"status":"success","value":..}` / `{"status":"error","errorMessage":..}`
//! envelope. All worker calls carry `ingestKey` (see CONTRACT.md).

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::model::{Article, Source};

/// Max articles per `ingestBatch` mutation (embeddings make payloads large).
const INGEST_BATCH_SIZE: usize = 50;

/// Aggregated `ingestBatch` results across all chunks.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct IngestStats {
    pub inserted: u64,
    pub updated: u64,
    pub events: u64,
}

/// Source health status reported after a fetch.
#[derive(Debug, Clone, Copy)]
pub enum HealthStatus {
    Ok,
    Warn,
    Err,
}

impl HealthStatus {
    fn as_str(self) -> &'static str {
        match self {
            HealthStatus::Ok => "ok",
            HealthStatus::Warn => "warn",
            HealthStatus::Err => "err",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope {
    status: String,
    #[serde(default)]
    value: Value,
    #[serde(default)]
    error_message: Option<String>,
}

/// Client over the Convex raw HTTP function API.
pub struct ConvexClient {
    http: reqwest::Client,
    base: String,
    ingest_key: String,
}

impl ConvexClient {
    /// Build a client. `base` is e.g. `http://127.0.0.1:3210` (no trailing slash).
    pub fn new(base: impl Into<String>, ingest_key: impl Into<String>) -> Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .context("building convex http client")?;
        Ok(Self {
            http,
            base: base.into().trim_end_matches('/').to_string(),
            ingest_key: ingest_key.into(),
        })
    }

    async fn call(&self, kind: &str, path: &str, args: Value) -> Result<Value> {
        let url = format!("{}/api/{kind}", self.base);
        let body = json!({ "path": path, "args": args, "format": "json" });
        let resp = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .with_context(|| format!("POST {url} ({path})"))?;
        let status = resp.status();
        let env: Envelope = resp
            .json()
            .await
            .with_context(|| format!("decoding {path} response (http {status})"))?;
        if env.status == "success" {
            Ok(env.value)
        } else {
            Err(anyhow!(
                "convex {path} error: {}",
                env.error_message.unwrap_or_else(|| "unknown".to_string())
            ))
        }
    }

    async fn query(&self, path: &str, args: Value) -> Result<Value> {
        self.call("query", path, args).await
    }

    async fn mutation(&self, path: &str, args: Value) -> Result<Value> {
        self.call("mutation", path, args).await
    }

    /// `ingest:listSources` → enabled sources for the fetch loop.
    pub async fn list_sources(&self) -> Result<Vec<Source>> {
        let value = self
            .query(
                "ingest:listSources",
                json!({ "ingestKey": self.ingest_key }),
            )
            .await?;
        serde_json::from_value(value).context("decoding listSources")
    }

    /// `ingest:consumeRefreshSignal` → true if an on-demand refresh was requested.
    pub async fn consume_refresh_signal(&self) -> Result<bool> {
        let value = self
            .mutation(
                "ingest:consumeRefreshSignal",
                json!({ "ingestKey": self.ingest_key }),
            )
            .await?;
        Ok(value.as_bool().unwrap_or(false))
    }

    /// `ingest:reportSourceHealth` rollup after a source fetch.
    pub async fn report_source_health(
        &self,
        url: &str,
        status: HealthStatus,
        error: Option<&str>,
        item_count: u64,
    ) -> Result<()> {
        let mut args = json!({
            "ingestKey": self.ingest_key,
            "url": url,
            "status": status.as_str(),
            "itemCount": item_count,
        });
        if let (HealthStatus::Err, Some(e)) = (status, error) {
            args["error"] = json!(e);
        }
        self.mutation("ingest:reportSourceHealth", args).await?;
        Ok(())
    }

    /// `ingest:ingestBatch` in chunks of [`INGEST_BATCH_SIZE`]; idempotent.
    pub async fn ingest_batch(&self, articles: &[Article]) -> Result<IngestStats> {
        let mut total = IngestStats::default();
        for chunk in articles.chunks(INGEST_BATCH_SIZE) {
            let args = json!({ "ingestKey": self.ingest_key, "articles": chunk });
            let value = self.mutation("ingest:ingestBatch", args).await?;
            // Convex encodes numbers as JSON floats (e.g. 1.0); as_u64 alone
            // returns None for those, so fall back through as_f64.
            let count = |v: &Value, k: &str| -> u64 {
                v.get(k)
                    .and_then(|n| n.as_u64().or_else(|| n.as_f64().map(|f| f as u64)))
                    .unwrap_or(0)
            };
            total.inserted += count(&value, "inserted");
            total.updated += count(&value, "updated");
            total.events += count(&value, "events");
        }
        Ok(total)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Article, Tier};

    /// Live round-trip against a running self-hosted Convex backend. Ignored by
    /// default (hermetic `cargo test`); run with:
    ///   CONVEX_URL=http://127.0.0.1:3210 MAPR_INGEST_KEY=mapr-dev-ingest-secret \
    ///   cargo test --features '' convex::tests::live_ingest_roundtrip -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "requires a running Convex backend (CONVEX_URL + MAPR_INGEST_KEY)"]
    async fn live_ingest_roundtrip() {
        let url = std::env::var("CONVEX_URL").expect("CONVEX_URL");
        let key = std::env::var("MAPR_INGEST_KEY").expect("MAPR_INGEST_KEY");
        let client = ConvexClient::new(url, key).unwrap();

        // Deterministic, L2-normalized 1024-dim vector.
        let raw: Vec<f32> = (0..1024).map(|i| ((i % 7) as f32) - 3.0).collect();
        let norm = raw.iter().map(|x| x * x).sum::<f32>().sqrt();
        let embedding: Vec<f32> = raw.iter().map(|x| x / norm).collect();

        let article = Article {
            external_id: "rust-it-1".into(),
            event_key: "rust-it-evt".into(),
            title: "Rust ingestor integration write".into(),
            summary: "Verifies the Rust convex client serializes ingestBatch correctly.".into(),
            source: "it".into(),
            url: Some("https://example.com/rust-it-1".into()),
            iso_a2: "UA".into(),
            lon: 30.52,
            lat: 50.45,
            tier: Tier::Red,
            severity: 7.7,
            category: "conflict".into(),
            published_at: 1_700_000_000_000,
            entities: vec!["Kyiv".into(), "Ukraine".into()],
            embedding,
            image_url: Some("https://example.com/rust-it-1.jpg".into()),
        };

        let stats = client
            .ingest_batch(std::slice::from_ref(&article))
            .await
            .unwrap();
        assert_eq!(stats.inserted + stats.updated, 1, "one article written");
        assert_eq!(stats.events, 1, "one event recomputed");

        // Idempotent: a second write updates (does not double-insert).
        let again = client
            .ingest_batch(std::slice::from_ref(&article))
            .await
            .unwrap();
        assert_eq!(again.updated, 1);
        assert_eq!(again.inserted, 0);

        // Read-side calls round-trip too.
        client.list_sources().await.unwrap();
        let _ = client.consume_refresh_signal().await.unwrap();
    }
}
