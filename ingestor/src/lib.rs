//! mapr-ingestor — library surface for the ingestion/enrichment/embedding
//! worker. The binary (`src/main.rs`) wires these into the periodic worker
//! loop; modules are exposed here so they are unit-tested and reusable.

pub mod config;
pub mod convex;
pub mod correlate;
pub mod dates;
pub mod dedup;
pub mod embed;
pub mod fetch;
pub mod geocode;
pub mod model;
pub mod ner;
pub mod pipeline;
pub mod severity;
pub mod ssrf;
pub mod velocity;
