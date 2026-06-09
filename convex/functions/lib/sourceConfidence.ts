import type { Doc } from "../_generated/dataModel";

export type SourceEvidence = Pick<Doc<"articles">, "source" | "publishedAt"> & {
  sourceType?: Doc<"sourceCatalog">["sourceType"];
  verificationLevel?: Doc<"sourceCatalog">["verificationLevel"];
};

export type SourceConfidence = {
  sourceCount: number;
  sourceDiversity: number;
  regionalSources: number;
  socialUnverified: number;
  verifiedSources: number;
  confidence: "low" | "medium" | "high";
  label: string;
};

type SourceClass = Pick<SourceEvidence, "sourceType" | "verificationLevel">;

/**
 * Resolve a source's type + verification level.
 *
 * The `sourceCatalog` row is the source of truth: when the caller has the
 * stored `sourceType` / `verificationLevel` (set by admin/source-request
 * flows), pass them as `stored` and they win field-by-field. Only the fields
 * the catalog leaves blank fall back to the name-substring heuristic below —
 * which is a last resort, not the primary signal. Calling with no `stored`
 * preserves the original heuristic-only behavior.
 */
export function classifySourceName(source: string, stored?: SourceClass): SourceClass {
  const heuristic = heuristicSourceClass(source);
  return {
    sourceType: stored?.sourceType ?? heuristic.sourceType,
    verificationLevel: stored?.verificationLevel ?? heuristic.verificationLevel,
  };
}

/** Name-substring fallback used only when the catalog has no stored metadata. */
function heuristicSourceClass(source: string): SourceClass {
  const s = source.toLowerCase();
  if (s.includes("mastodon") || s.includes("bluesky")) {
    return { sourceType: "social", verificationLevel: "unverified" };
  }
  if (s.includes("un news") || s.includes("reliefweb")) {
    return { sourceType: "ngo", verificationLevel: "verified" };
  }
  if (s.includes("reuters") || s.includes("bbc") || s.includes("npr") || s.includes("guardian") || s.includes("al jazeera")) {
    return { sourceType: "wire", verificationLevel: "verified" };
  }
  return { sourceType: "regional", verificationLevel: "mixed" };
}

/**
 * Build SourceEvidence rows from article docs (or any row carrying `source` +
 * `publishedAt`). `sourceType`/`verificationLevel` are not stored on articles;
 * `summarizeSources` resolves them via `classifySourceName(source)` when absent,
 * so this stays a pure, read-free transform.
 */
export function evidenceFromArticles(
  rows: { source: string; publishedAt: number }[],
): SourceEvidence[] {
  return rows.map((r) => ({ source: r.source, publishedAt: r.publishedAt }));
}

/** Trimmed confidence summary for compact UI strips (no diagnostic counts). */
export type SourceStrength = {
  confidence: SourceConfidence["confidence"];
  label: string;
  verifiedSources: number;
  socialUnverified: number;
};

export function sourceStrength(items: SourceEvidence[]): SourceStrength {
  const s = summarizeSources(items);
  return {
    confidence: s.confidence,
    label: s.label,
    verifiedSources: s.verifiedSources,
    socialUnverified: s.socialUnverified,
  };
}

export function summarizeSources(items: SourceEvidence[]): SourceConfidence {
  const names = new Set<string>();
  const types = new Set<string>();
  const regional = new Set<string>();
  const social = new Set<string>();
  const verified = new Set<string>();

  for (const item of items) {
    names.add(item.source);
    // Stored catalog metadata (when present) is authoritative; the name
    // heuristic only fills the gaps it leaves blank.
    const resolved = classifySourceName(item.source, {
      sourceType: item.sourceType,
      verificationLevel: item.verificationLevel,
    });
    const sourceType = resolved.sourceType ?? "other";
    const verificationLevel = resolved.verificationLevel ?? "mixed";
    types.add(sourceType);
    if (sourceType === "regional") regional.add(item.source);
    if (sourceType === "social" && verificationLevel === "unverified") social.add(item.source);
    if (verificationLevel === "verified") verified.add(item.source);
  }

  const sourceCount = names.size;
  const sourceDiversity = types.size;
  const regionalSources = regional.size;
  const socialUnverified = social.size;
  const verifiedSources = verified.size;
  let confidence: SourceConfidence["confidence"] = "low";
  if (sourceCount >= 5 && sourceDiversity >= 2 && verifiedSources >= 2) confidence = "high";
  else if (sourceCount >= 2 && verifiedSources >= 1) confidence = "medium";
  const parts = [`${sourceCount} source${sourceCount === 1 ? "" : "s"}`];
  if (regionalSources > 0) parts.push(`${regionalSources} regional`);
  if (verifiedSources > 0) parts.push(`${verifiedSources} verified`);
  if (socialUnverified > 0) parts.push(`${socialUnverified} social unverified`);

  return {
    sourceCount,
    sourceDiversity,
    regionalSources,
    socialUnverified,
    verifiedSources,
    confidence,
    label: parts.join(" · "),
  };
}
