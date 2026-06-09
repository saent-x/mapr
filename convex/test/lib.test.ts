import { test } from "node:test";
import assert from "node:assert/strict";
import { recencyBucket, bucketsWithin } from "../functions/lib/recency.ts";
import { referencedIndices, shouldBypassCorpusRetrieval } from "../functions/lib/qa.ts";
import { parseQuery, interpret, type EventLike } from "../functions/lib/intent.ts";
import { limitsForTier, tierForUser, hasFeature } from "../functions/lib/entitlements.ts";
import { summarizeSources } from "../functions/lib/sourceConfidence.ts";

const NOW = 1_000_000_000_000;
const H = 3_600_000;

test("recencyBucket classifies by age at ingest", () => {
  assert.equal(recencyBucket(NOW - 0.5 * H, NOW), "h1");
  assert.equal(recencyBucket(NOW - 3 * H, NOW), "h6");
  assert.equal(recencyBucket(NOW - 20 * H, NOW), "h24");
  assert.equal(recencyBucket(NOW - 50 * H, NOW), "h72");
  assert.equal(recencyBucket(NOW - 150 * H, NOW), "h168");
  assert.equal(recencyBucket(NOW - 400 * H, NOW), "old");
});

test("bucketsWithin returns the sound OR-set for a window", () => {
  // An in-window article's label-age <= current-age <= window, so its bucket's
  // lower bound is below the window — these are exactly the buckets to OR over.
  assert.deepEqual(bucketsWithin(1), ["h1"]);
  assert.deepEqual(bucketsWithin(24), ["h1", "h6", "h24"]);
  assert.deepEqual(bucketsWithin(168), ["h1", "h6", "h24", "h72", "h168"]);
  assert.ok(bucketsWithin(400).includes("old"));
});

test("referencedIndices extracts distinct in-range [n] markers", () => {
  assert.deepEqual(referencedIndices("Bottom line [1]. Also [3] and again [1].", 5), [1, 3]);
  assert.deepEqual(referencedIndices("no citations here", 5), []);
  // Out-of-range markers are ignored (model can't cite beyond the corpus).
  assert.deepEqual(referencedIndices("see [9] and [2]", 3), [2]);
});

test("shouldBypassCorpusRetrieval only skips short conversational turns", () => {
  assert.equal(shouldBypassCorpusRetrieval("hi"), true);
  assert.equal(shouldBypassCorpusRetrieval("thanks"), true);
  assert.equal(shouldBypassCorpusRetrieval("what is happening in ukraine right now"), false);
  assert.equal(shouldBypassCorpusRetrieval("red-tier conflict"), false);
});

test("parseQuery extracts tiers, categories, regions, window, intent", () => {
  const p = parseQuery("red-tier cyber in europe in the last 6 hours");
  assert.deepEqual(p.tiers, ["red"]);
  assert.deepEqual(p.cats, ["cyber"]);
  assert.ok(p.regions.includes("DE"));
  assert.equal(p.win?.hrs, 6);
  assert.equal(p.intent, "filter");

  assert.equal(parseQuery("how many events today").intent, "count");
  assert.equal(parseQuery("what's spiking right now").intent, "anomalies");
  assert.equal(parseQuery("top hotspots").intent, "regions");
  assert.equal(parseQuery("top 3 by severity").topN, 3);
});

function ev(id: string, iso: string, tier: EventLike["tier"], sev: number, cat: string, ageH: number, title: string): EventLike {
  return { id, isoA2: iso, tier, severity: sev, category: cat, publishedAt: NOW - ageH * H, title, summary: title, source: "X" };
}

test("interpret filters the event set deterministically", () => {
  const events = [
    ev("a", "UA", "red", 8.2, "conflict", 0.5, "Drone interception over Kyiv"),
    ev("b", "IL", "red", 7.5, "conflict", 1.2, "Cross-border strikes"),
    ev("c", "DE", "amber", 5.1, "cyber", 2, "Ransomware in Germany"),
    ev("d", "JP", "green", 3.2, "seismic", 12, "Quake off Honshu"),
  ];
  const p = parseQuery("red-tier conflict in the last hour");
  const r = interpret(p, events, 168 * H, NOW);
  assert.equal(r.intent, "filter");
  assert.equal(r.matchCount, 1); // only Kyiv is within 1h
  assert.deepEqual(r.eventIds, ["a"]);

  const all = interpret(parseQuery("conflict"), events, 168 * H, NOW);
  assert.equal(all.matchCount, 2); // UA + IL within default window

  const counted = interpret(parseQuery("how many events"), events, 168 * H, NOW);
  assert.equal(counted.intent, "count");
  assert.equal(counted.matchCount, 4);
});

test("interpret routes faceted/intent queries to the map and free-form to QA", () => {
  const events = [ev("a", "UA", "red", 8.2, "conflict", 0.5, "Drone over Kyiv")];
  // Faceted -> map (deterministic filter drives markers).
  assert.equal(interpret(parseQuery("red conflict events"), events, 168 * H, NOW).route, "map");
  // Recognized intent without facets -> still map.
  assert.equal(interpret(parseQuery("what's spiking"), events, 168 * H, NOW).route, "map");
  assert.equal(interpret(parseQuery("top hotspots"), events, 168 * H, NOW).route, "map");
  // Free-form question with no parsed facets -> RAG QA.
  assert.equal(interpret(parseQuery("what do you make of all this"), events, 168 * H, NOW).route, "qa");
});

test("entitlements define free, pro, and admin product boundaries", () => {
  assert.equal(tierForUser(null), "free");
  assert.equal(tierForUser({ role: "user", subscriptionStatus: "active" }), "pro");
  assert.equal(tierForUser({ role: "admin", subscriptionStatus: "free" }), "admin");
  assert.equal(limitsForTier("free").qaTurns, 10);
  assert.equal(limitsForTier("pro").qaTurns, 200);
  assert.equal(hasFeature({ role: "user", subscriptionStatus: "free" }, "brief_generate"), false);
  assert.equal(hasFeature({ role: "user", subscriptionStatus: "active" }, "brief_generate"), true);
  assert.equal(hasFeature({ role: "admin", subscriptionStatus: "free" }, "custom_sources"), true);
});

test("source confidence is computed from evidence, not model prose", () => {
  const high = summarizeSources([
    { source: "BBC World", publishedAt: NOW },
    { source: "Reuters", publishedAt: NOW },
    { source: "ReliefWeb Updates", publishedAt: NOW },
    { source: "Mastodon · #conflict", publishedAt: NOW },
    { source: "The Standard (Kenya)", publishedAt: NOW },
  ]);
  assert.equal(high.confidence, "high");
  assert.equal(high.socialUnverified, 1);
  assert.ok(high.label.includes("social unverified"));

  const low = summarizeSources([{ source: "Mastodon · #breakingnews", publishedAt: NOW }]);
  assert.equal(low.confidence, "low");
  assert.equal(low.socialUnverified, 1);
});
