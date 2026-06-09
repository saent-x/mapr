// RecencyBucket is the source-of-truth union; schema.ts mirrors it as a Convex
// validator (keep the two in sync). Kept dependency-free so it is unit-testable.
export type RecencyBucket = "h1" | "h6" | "h24" | "h72" | "h168" | "old";

const HOUR = 3_600_000;

// Upper age bound (hours) that defines each bucket at ingest time.
const BUCKET_UPPER: Record<RecencyBucket, number> = {
  h1: 1,
  h6: 6,
  h24: 24,
  h72: 72,
  h168: 168,
  old: Infinity,
};
// Lower age bound (hours) per bucket — the youngest age this label can carry.
const BUCKET_LOWER: Record<RecencyBucket, number> = {
  h1: 0,
  h6: 1,
  h24: 6,
  h72: 24,
  h168: 72,
  old: 168,
};

/**
 * Bucket an article's age into a coarse, *equality-filterable* class.
 *
 * The label is frozen at ingest and is NOT re-bucketed as the article ages
 * (and, with the ingestor's "only embed changed" optimization, an unchanged
 * article is never re-written, so its bucket can drift arbitrarily stale).
 * Because of that, `recencyBucket` is only ever a COARSE HINT for narrowing a
 * vector/search scan — never a correctness filter. Exact recency is always
 * enforced afterward by a `publishedAt` post-filter against the live window.
 */
export function recencyBucket(publishedAt: number, now: number = Date.now()): RecencyBucket {
  const ageHours = (now - publishedAt) / HOUR;
  for (const b of ["h1", "h6", "h24", "h72", "h168"] as RecencyBucket[]) {
    if (ageHours <= BUCKET_UPPER[b]) return b;
  }
  return "old";
}

/**
 * The set of buckets used as a COARSE prefilter for an in-window vector/search
 * scan — never a correctness filter (exact recency is enforced afterward by a
 * `publishedAt` post-filter; see rag.ts).
 *
 * This is provably a *superset* of the buckets that can hold an in-window
 * article, so it never excludes a still-valid one: a frozen label can only
 * UNDER-state an article's current age — labels are set at ingest, age only
 * grows, and unchanged articles are never re-bucketed (the ingestor's "only
 * embed changed" path skips re-writing them). Hence any article whose true age
 * is < windowHours carries a label whose lower bound is < windowHours, so it
 * survives this filter; the post-filter then drops the ones that have since
 * aged out of the live window.
 */
export function bucketsWithin(windowHours: number): RecencyBucket[] {
  const all: RecencyBucket[] = ["h1", "h6", "h24", "h72", "h168", "old"];
  return all.filter((b) => BUCKET_LOWER[b] < windowHours);
}
