//! mapr-ingestor binary entrypoint — ingestion worker.
//!
//!   default: periodic fetch → enrich → embed (Ollama) → write loop, also
//!            reacting to `ingest:consumeRefreshSignal`.
//!   --once:  run exactly ONE cycle then exit (integration check).

use std::time::{Duration, Instant};

use anyhow::Result;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use mapr_ingestor::config::Config;
use mapr_ingestor::convex::ConvexClient;
use mapr_ingestor::embed::OllamaEmbedder;
use mapr_ingestor::fetch;
use mapr_ingestor::pipeline;

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();
    let cfg = Config::from_env()?;
    let once = std::env::args().any(|a| a == "--once");

    let http = fetch::build_client()?;
    let convex = ConvexClient::new(&cfg.convex_url, &cfg.ingest_key)?;
    let embedder = OllamaEmbedder::new(&cfg.ollama_url, &cfg.embed_model)?;
    let fetch_timeout = Duration::from_secs(cfg.fetch_timeout_secs);

    if once {
        let r = pipeline::run_cycle(&http, &convex, &embedder, fetch_timeout).await?;
        println!(
            "{}",
            serde_json::json!({
                "sources": r.sources,
                "raw_items": r.raw_items,
                "articles": r.articles,
                "inserted": r.stats.inserted,
                "updated": r.stats.updated,
                "events": r.stats.events,
            })
        );
        return Ok(());
    }

    let interval = Duration::from_secs(cfg.ingest_interval_secs);
    let poll = interval
        .min(Duration::from_secs(15))
        .max(Duration::from_secs(1));

    info!(
        interval_secs = cfg.ingest_interval_secs,
        "ingestor worker started"
    );
    run_and_log(&http, &convex, &embedder, fetch_timeout).await;
    let mut last = Instant::now();
    loop {
        tokio::select! {
            _ = tokio::time::sleep(poll) => {}
            _ = tokio::signal::ctrl_c() => { info!("shutdown signal received"); break; }
        }
        let refresh = convex.consume_refresh_signal().await.unwrap_or(false);
        if refresh || last.elapsed() >= interval {
            if refresh {
                info!("refresh signal received");
            }
            run_and_log(&http, &convex, &embedder, fetch_timeout).await;
            last = Instant::now();
        }
    }
    Ok(())
}

fn init_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
}

async fn run_and_log(
    http: &reqwest::Client,
    convex: &ConvexClient,
    embedder: &OllamaEmbedder,
    fetch_timeout: Duration,
) {
    match pipeline::run_cycle(http, convex, embedder, fetch_timeout).await {
        Ok(r) => info!(
            sources = r.sources,
            raw = r.raw_items,
            articles = r.articles,
            inserted = r.stats.inserted,
            updated = r.stats.updated,
            events = r.stats.events,
            "ingest cycle complete"
        ),
        Err(e) => warn!(error = %e, "ingest cycle failed"),
    }
}
