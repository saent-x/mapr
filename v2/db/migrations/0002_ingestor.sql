-- MAPR v2 ingestor bookkeeping. Additive only: no existing table is changed.
-- Idempotent, so the ingestor can also apply it at startup on a database
-- that was initialised before this file existed.

-- MinHash LSH band index for near-duplicate lookup (title + lead).
-- Rows go with their article (deleted at 7 days by mapr_retention()).
CREATE TABLE IF NOT EXISTS article_bands (
  band_key   bigint NOT NULL,                       -- band index * 2^32 + band hash
  article_id bigint NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  PRIMARY KEY (band_key, article_id)
);
CREATE INDEX IF NOT EXISTS article_bands_article ON article_bands (article_id);

-- Per-source poll state that sources does not carry: when we last tried
-- (for the daily re-probe of auto-skipped feeds) and a hash of the last body
-- (many feeds ignore ETag; an unchanged body is not parsed again).
CREATE TABLE IF NOT EXISTS source_polls (
  source_id       int PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
  last_attempt_at timestamptz,
  last_status     int,
  body_hash       text,
  final_url       text
);

-- When an event last changed (new source, new article; later: triage results).
-- events.last_seen is story time (newest article's publication), so the
-- Worker's "what changed since my last call" cursor needs its own clock.
CREATE TABLE IF NOT EXISTS event_activity (
  event_id   bigint PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_activity_updated ON event_activity (updated_at DESC);

-- The account-wide figure already includes MAPR's own use. Snapshot MAPR's
-- counter when the account figure is read, so only MAPR's use since that read
-- is added on top (otherwise MAPR is counted twice and the gate closes early).
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS mapr_neurons_at_read double precision;
