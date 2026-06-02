import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/access";
import { requireFeature } from "./lib/entitlements";

function line(items: string[]): string {
  return items.filter(Boolean).join("\n");
}

export const briefMarkdown = query({
  args: { id: v.id("briefs") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    requireFeature(user, "dossier_export");
    const brief = await ctx.db.get(args.id);
    if (!brief || brief.userId !== user._id) throw new Error("FORBIDDEN");
    const sections = brief.sections.map((s) => `## ${s.title}\n\n${s.body}`).join("\n\n");
    const citations = brief.citations.map((c) => `- [${c.index}] ${c.title} — ${c.source}${c.url ? ` (${c.url})` : ""}`).join("\n");
    return line([
      `# ${brief.title}`,
      `Generated: ${new Date(brief.createdAt).toISOString()}`,
      `Window: ${new Date(brief.windowStart).toISOString()} – ${new Date(brief.windowEnd).toISOString()}`,
      "",
      brief.summary,
      "",
      sections,
      "",
      "## Source appendix",
      citations || "No citations available.",
    ]);
  },
});

export const caseMarkdown = query({
  args: { id: v.id("cases") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    requireFeature(user, "dossier_export");
    const c = await ctx.db.get(args.id);
    if (!c || c.userId !== user._id) throw new Error("FORBIDDEN");
    const items = await ctx.db
      .query("caseItems")
      .withIndex("by_case", (q) => q.eq("caseId", args.id))
      .order("asc")
      .collect();
    const body = items.map((item) => {
      const meta = [item.region, item.source, item.severity == null ? "" : `sev ${item.severity}`].filter(Boolean).join(" · ");
      return `- **${item.title}**${meta ? ` (${meta})` : ""}${item.summary ? ` — ${item.summary}` : ""}${item.url ? `\n  ${item.url}` : ""}`;
    }).join("\n");
    return line([
      `# ${c.title}`,
      c.description ?? "",
      `Status: ${c.status}`,
      `Updated: ${new Date(c.updatedAt).toISOString()}`,
      "",
      "## Evidence",
      body || "No case items yet.",
    ]);
  },
});

export const eventsCsv = query({
  args: { windowHours: v.optional(v.number()), isoA2: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    requireFeature(user, "dossier_export");
    const cutoff = Date.now() - (args.windowHours ?? 168) * 3_600_000;
    const rows = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", cutoff))
      .order("desc")
      .take(1000);
    const filtered = args.isoA2 ? rows.filter((e) => e.isoA2 === args.isoA2) : rows;
    const escape = (s: string) => `"${s.replaceAll("\"", "\"\"")}"`;
    return ["publishedAt,isoA2,tier,severity,category,title,source,url", ...filtered.map((e) => [
      new Date(e.publishedAt).toISOString(),
      e.isoA2,
      e.tier,
      String(e.severity),
      e.category,
      escape(e.title),
      escape(e.source),
      escape(e.url ?? ""),
    ].join(","))].join("\n");
  },
});
