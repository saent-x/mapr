-- Higher priority runs first; within a priority, the newest job. Triage uses the event's
-- distinct-source count, so corroborated events are scored before single-source ones.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS jobs_claim ON jobs (priority DESC, id DESC) WHERE locked_at IS NULL;
