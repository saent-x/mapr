-- Events (and their 1024-dim centroids) are kept 30 days, not 90 (tor, 2026-11-22): at ~63k events a
-- week the events table and its HNSW index grew ~0.9 GB a week. The desk shows 72h; search keeps 30 days.
CREATE OR REPLACE FUNCTION mapr_retention() RETURNS void LANGUAGE sql AS $$
  UPDATE articles SET body_text = NULL WHERE body_text IS NOT NULL AND fetched_at < now() - interval '72 hours';
  DELETE FROM articles WHERE fetched_at < now() - interval '7 days';
  DELETE FROM events WHERE NOT pinned AND last_seen < now() - interval '30 days';
  DELETE FROM jobs WHERE attempts >= 8 AND run_after < now() - interval '14 days';
  DELETE FROM ai_usage WHERE day < current_date - 90;
$$;
