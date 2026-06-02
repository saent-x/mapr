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

export function classifySourceName(source: string): Pick<SourceEvidence, "sourceType" | "verificationLevel"> {
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

export function summarizeSources(items: SourceEvidence[]): SourceConfidence {
  const names = new Set<string>();
  const types = new Set<string>();
  const regional = new Set<string>();
  const social = new Set<string>();
  const verified = new Set<string>();

  for (const item of items) {
    names.add(item.source);
    const fallback = classifySourceName(item.source);
    const sourceType = item.sourceType ?? fallback.sourceType ?? "other";
    const verificationLevel = item.verificationLevel ?? fallback.verificationLevel ?? "mixed";
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
