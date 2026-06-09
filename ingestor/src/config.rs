//! Runtime configuration loaded from environment variables.

use anyhow::{Context, Result};

/// Ingestion worker configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// Convex deployment URL, e.g. `http://127.0.0.1:3210`.
    pub convex_url: String,
    /// Worker authorization passed as `ingestKey` on every call.
    pub ingest_key: String,
    /// Ollama base URL for embeddings, e.g. `http://ollama:11434`.
    pub ollama_url: String,
    /// Embedding model name (default `bge-m3`).
    pub embed_model: String,
    /// Seconds between periodic ingest cycles (default 900).
    pub ingest_interval_secs: u64,
    /// Per-source fetch timeout in seconds (default 20).
    pub fetch_timeout_secs: u64,
}

fn env_opt(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}

fn env_or(key: &str, default: &str) -> String {
    env_opt(key).unwrap_or_else(|| default.to_string())
}

fn env_parse<T: std::str::FromStr>(key: &str, default: T) -> T {
    env_opt(key).and_then(|v| v.parse().ok()).unwrap_or(default)
}

impl Config {
    /// Load from the environment. `CONVEX_URL`, `MAPR_INGEST_KEY`, and
    /// `OLLAMA_URL` are required.
    pub fn from_env() -> Result<Self> {
        let convex_url =
            env_opt("CONVEX_URL").context("CONVEX_URL is required (e.g. http://127.0.0.1:3210)")?;
        let ingest_key = env_opt("MAPR_INGEST_KEY").context("MAPR_INGEST_KEY is required")?;
        let ollama_url =
            env_opt("OLLAMA_URL").context("OLLAMA_URL is required (e.g. http://ollama:11434)")?;
        Ok(Self {
            convex_url,
            ingest_key,
            ollama_url,
            embed_model: env_or("EMBED_MODEL", "bge-m3"),
            ingest_interval_secs: env_parse("INGEST_INTERVAL_SECS", 900),
            fetch_timeout_secs: env_parse("FETCH_TIMEOUT_SECS", 20),
        })
    }
}
