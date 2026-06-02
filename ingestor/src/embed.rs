//! Embeddings via Ollama (`/api/embed`). One bge-m3 service serves both the
//! ingestor and Convex query-time embeddings — no in-process ONNX runtime or
//! model files to manage.

use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;

/// bge-m3 embedding dimensionality (locked by the Convex contract).
pub const EMBED_DIM: usize = 1024;

/// L2-normalize a vector in place. Zero vectors are left untouched.
pub fn l2_normalize(v: &mut [f32]) {
    let norm = v
        .iter()
        .map(|x| (*x as f64) * (*x as f64))
        .sum::<f64>()
        .sqrt();
    if norm > 0.0 {
        for x in v.iter_mut() {
            *x = (*x as f64 / norm) as f32;
        }
    }
}

#[derive(Deserialize)]
struct EmbedResponse {
    embeddings: Vec<Vec<f32>>,
}

/// Embeds batches of text through Ollama, returning 1024-dim L2-normalized
/// vectors (one per input, in order).
pub struct OllamaEmbedder {
    http: reqwest::Client,
    base: String,
    model: String,
}

impl OllamaEmbedder {
    pub fn new(base: impl Into<String>, model: impl Into<String>) -> Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .context("building ollama http client")?;
        Ok(Self {
            http,
            base: base.into().trim_end_matches('/').to_string(),
            model: model.into(),
        })
    }

    pub async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let url = format!("{}/api/embed", self.base);
        let resp = self
            .http
            .post(&url)
            .json(&serde_json::json!({ "model": self.model, "input": texts }))
            .send()
            .await
            .with_context(|| format!("POST {url}"))?;
        if !resp.status().is_success() {
            return Err(anyhow!("ollama embed returned {}", resp.status()));
        }
        let mut data: EmbedResponse = resp
            .json()
            .await
            .context("decoding ollama embed response")?;
        if data.embeddings.len() != texts.len() {
            return Err(anyhow!(
                "ollama returned {} embeddings for {} inputs",
                data.embeddings.len(),
                texts.len()
            ));
        }
        for v in data.embeddings.iter_mut() {
            if v.len() != EMBED_DIM {
                return Err(anyhow!(
                    "expected {EMBED_DIM}-dim embedding, got {}",
                    v.len()
                ));
            }
            l2_normalize(v);
        }
        Ok(data.embeddings)
    }
}

#[cfg(test)]
pub fn dummy_vector(seed: f32) -> Vec<f32> {
    let mut v: Vec<f32> = (0..EMBED_DIM).map(|i| seed + (i % 13) as f32).collect();
    l2_normalize(&mut v);
    v
}
