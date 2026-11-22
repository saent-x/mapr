-- Event location from the embedder's /geocode (NER + GeoNames). place/country/lat/lon already exist.
-- geo_precision: city | admin1 | region | water | country | source (outlet's country, nothing named).
ALTER TABLE events ADD COLUMN IF NOT EXISTS geo_precision text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS geo_conf real;
ALTER TABLE events ADD COLUMN IF NOT EXISTS geocoded_at timestamptz;
CREATE INDEX IF NOT EXISTS events_ungeocoded ON events (last_seen DESC) WHERE geocoded_at IS NULL;
