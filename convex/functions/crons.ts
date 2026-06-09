import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Drain the corpus daily. 14 days comfortably covers every reader — the map and
// RAG cap at 7 days, and intentSearch's anomaly baseline scans 2x the 7-day
// window — while the embedding-bearing articles table (the bulk of storage) is
// the main thing kept bounded. pruneOld self-reschedules to clear the full
// backlog regardless of size.
crons.daily(
  "prune-old-corpus",
  { hourUTC: 4, minuteUTC: 30 },
  internal.ingest.pruneOld,
  { olderThanDays: 14 },
);

// Hourly tick that fans out any daily digests due this UTC hour.
crons.hourly("daily-digest-sweep", { minuteUTC: 5 }, internal.digests.runDailyDigests, {});

// Per-cycle standing-watch evaluation (B2). Diffs each watch against its frozen
// baseline and writes a DETERMINISTIC in-app alert-stream row for watches with
// new events. Prose synthesis is intentionally NOT here — it runs only on an
// explicit user click — so this stays cheap and never queues LLM generations.
crons.hourly("watch-baseline-sweep", { minuteUTC: 15 }, internal.watchBaselines.sweepWatches, {});

// Ingest dead-man's switch (#11). Derives the last successful ingest from
// existing data and, if it's stale beyond the threshold, emails the admin via
// the existing Resend integration. Cheap + silent when healthy; no-ops when
// email isn't configured.
crons.interval("ingest-health-check", { minutes: 30 }, internal.ops.checkIngestHealth, {});

// ── Source-catalog maintenance (keep the global feed list healthy) ──
// Daily: sync any newly-curated DEFAULT_SOURCES into the catalog and auto-disable
// feeds that have been dead for too many cycles in a row (the ingestor then skips
// them). Runs before the 04:30 prune so a fresh catalog drives the next cycles.
crons.daily("source-catalog-maintain", { hourUTC: 3, minuteUTC: 30 }, internal.sourceSync.maintainCatalog, {});

// Daily: re-fetch auto-disabled feeds and re-enable the ones that recovered.
crons.daily("source-probe-recover", { hourUTC: 3, minuteUTC: 45 }, internal.sourceSync.probeDisabledSources, {});

// Weekly: flag regions with real news volume but no dedicated feed into the admin
// review queue (with an optional LLM-suggested outlet). Never auto-enables.
crons.weekly(
  "source-gap-discovery",
  { dayOfWeek: "monday", hourUTC: 6, minuteUTC: 0 },
  internal.sourceSync.discoverCandidates,
  {},
);

export default crons;
