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
// Lower age bound (hours) per bucket.
const BUCKET_LOWER: Record<RecencyBucket, number> = {
  h1: 0,
  h6: 1,
  h24: 6,
  h72: 24,
  h168: 72,
  old: 168,
};

/** Bucket an article's age into a coarse, *equality-filterable* class. */
export function recencyBucket(publishedAt: number, now: number = Date.now()): RecencyBucket {
  const ageHours = (now - publishedAt) / HOUR;
  for (const b of ["h1", "h6", "h24", "h72", "h168"] as RecencyBucket[]) {
    if (ageHours <= BUCKET_UPPER[b]) return b;
  }
  return "old";
}

/**
 * The set of buckets that could contain an article whose *current* age is
 * <= windowHours. Sound because a bucket label is set at ingest and an
 * article's label-age never exceeds its current age (labelAge <= currentAge
 * <= window), so any in-window article lives in a bucket whose lower bound is
 * below the window. Vector search filters by OR-ing these; exact recency is
 * enforced afterward by a publishedAt post-filter.
 */
export function bucketsWithin(windowHours: number): RecencyBucket[] {
  const all: RecencyBucket[] = ["h1", "h6", "h24", "h72", "h168", "old"];
  return all.filter((b) => BUCKET_LOWER[b] < windowHours);
}
