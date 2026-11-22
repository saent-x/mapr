-- MAPR v2 schema. Keep facts, not articles: article text is cache, events are the record.
-- Runs on ParadeDB (Postgres + pgvector + pg_search).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_search;

-- Feeds we poll. Conditional-GET state lives here so unchanged feeds cost one 304.
CREATE TABLE sources (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  url           text NOT NULL UNIQUE,
  kind          text NOT NULL CHECK (kind IN ('rss', 'gdelt')),
  region        text,
  category      text,
  enabled       boolean NOT NULL DEFAULT true,
  etag          text,
  last_modified text,
  fail_count    int NOT NULL DEFAULT 0,
  last_ok_at    timestamptz,
  last_error    text
);

-- Events: the durable record. Kept 90 days unless pinned to a case.
CREATE TABLE events (
  id             bigserial PRIMARY KEY,
  title          text NOT NULL,
  summary        text,
  first_seen     timestamptz NOT NULL DEFAULT now(),
  last_seen      timestamptz NOT NULL DEFAULT now(),
  severity       smallint CHECK (severity BETWEEN 1 AND 4),
  severity_conf  real,
  relevant       boolean,
  relevance_conf real,
  category       text,
  place          text,
  country        char(2),
  lat            double precision,
  lon            double precision,
  facts          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- Clairic typed fields, each with a source span
  source_count   int NOT NULL DEFAULT 0,
  article_count  int NOT NULL DEFAULT 0,
  centroid       vector(1024),
  triaged_at     timestamptz,
  pinned         boolean NOT NULL DEFAULT false       -- saved to a case: exempt from expiry
);
CREATE INDEX events_last_seen ON events (last_seen DESC);
CREATE INDEX events_untriaged ON events (first_seen) WHERE triaged_at IS NULL;
CREATE INDEX events_centroid ON events USING hnsw (centroid vector_cosine_ops);
CREATE INDEX events_bm25 ON events USING bm25 (id, title, summary, place, category);

-- Articles: throwaway input. body_text is cleared at 72h, rows deleted at 7 days.
CREATE TABLE articles (
  id            bigserial PRIMARY KEY,
  source_id     int NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  url           text NOT NULL UNIQUE,                 -- canonicalised
  title         text NOT NULL,
  lead          text,
  body_text     text,
  lang          text,
  published_at  timestamptz,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  minhash       int[],                                -- near-duplicate detection
  embedding     vector(1024),
  event_id      bigint REFERENCES events(id) ON DELETE SET NULL
);
CREATE INDEX articles_fetched ON articles (fetched_at);
CREATE INDEX articles_event ON articles (event_id);
CREATE INDEX articles_embedding ON articles USING hnsw (embedding vector_cosine_ops);

-- What an event cites. Survives the article purge: url, title and a short span only.
CREATE TABLE event_sources (
  event_id     bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source_id    int NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  url          text NOT NULL,
  title        text NOT NULL,
  published_at timestamptz,
  span         text CHECK (length(span) <= 300),
  PRIMARY KEY (event_id, url)
);

-- Work queue (SELECT ... FOR UPDATE SKIP LOCKED). Held, never dropped, when the AI budget is spent.
CREATE TABLE jobs (
  id         bigserial PRIMARY KEY,
  kind       text NOT NULL,
  payload    jsonb NOT NULL,
  run_after  timestamptz NOT NULL DEFAULT now(),
  attempts   int NOT NULL DEFAULT 0,
  locked_at  timestamptz,
  last_error text,
  dedupe_key text UNIQUE                              -- makes retries idempotent
);
CREATE INDEX jobs_ready ON jobs (run_after) WHERE locked_at IS NULL;

-- Workers AI spend, ours and the whole account's, so we stay inside the free daily neurons.
CREATE TABLE ai_usage (
  day              date PRIMARY KEY,
  mapr_neurons     double precision NOT NULL DEFAULT 0,
  account_neurons  double precision,
  account_read_at  timestamptz
);

-- Mirror of watches from D1, with an embedding for the vector pre-filter.
CREATE TABLE watches (
  id         text PRIMARY KEY,
  user_id    text NOT NULL,
  spec       jsonb NOT NULL,
  embedding  vector(1024),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE matches (
  watch_id   text NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  event_id   bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  score      real NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  alerted_at timestamptz,
  PRIMARY KEY (watch_id, event_id)
);

-- Retention. Called every hour by the server's scheduler.
CREATE FUNCTION mapr_retention() RETURNS void LANGUAGE sql AS $$
  UPDATE articles SET body_text = NULL WHERE body_text IS NOT NULL AND fetched_at < now() - interval '72 hours';
  DELETE FROM articles WHERE fetched_at < now() - interval '7 days';
  DELETE FROM events WHERE NOT pinned AND last_seen < now() - interval '90 days';
  DELETE FROM jobs WHERE attempts >= 8 AND run_after < now() - interval '14 days';
  DELETE FROM ai_usage WHERE day < current_date - 90;
$$;
