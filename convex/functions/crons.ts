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

export default crons;
