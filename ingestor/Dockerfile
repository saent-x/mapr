# ingestor/Dockerfile
# MAPR ingestion worker — pure release build, no ONNX/ort, no model files.
# Multi-stage: cache deps, then ship a slim runtime with just the binary.

# --- Builder ---------------------------------------------------------------
FROM rust:1-slim AS builder
WORKDIR /app

# rustls-tls needs no OpenSSL; reqwest + scraper compile with the base toolchain.
# Layer-cache dependencies: compile a stub (lib + bin) against the real
# manifests first, so dependency builds are reused unless Cargo.toml changes.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src \
    && echo 'fn main() {}' > src/main.rs \
    && : > src/lib.rs \
    && cargo build --release \
    && rm -rf src

# Build the real binary (plain release build — NO features).
COPY src ./src
RUN touch src/main.rs src/lib.rs && cargo build --release

# --- Runtime ---------------------------------------------------------------
FROM debian:bookworm-slim AS runtime
# ca-certificates: outbound HTTPS to news sources, Ollama and Convex.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/mapr-ingestor /usr/local/bin/mapr-ingestor

# Non-root.
RUN useradd --system --uid 10001 --no-create-home ingestor
USER ingestor

ENTRYPOINT ["/usr/local/bin/mapr-ingestor"]
