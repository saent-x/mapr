import { internalAction, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

interface DueRule {
  ruleId: string;
  email: string;
  name: string;
  severityThreshold: number;
  isoA2?: string;
  category?: string;
  keyword?: string;
}

interface DueWatch {
  itemId: string;
  email: string;
  label: string;
  type: string;
  value: string;
}


/** Active daily-digest rules due at the given UTC hour, with a delivery email. */
export const dueDailyDigests = internalQuery({
  args: { hourUTC: v.number() },
  handler: async (ctx, args): Promise<DueRule[]> => {
    const rules = await ctx.db.query("alertRules").collect();
    const out: DueRule[] = [];
    for (const r of rules) {
      if (!r.active) continue;
      if (r.digestSchedule?.cadence !== "daily") continue;
      if (r.digestSchedule.hourUTC !== args.hourUTC) continue;
      let email = r.emailAddress;
      if (!email) {
        const user = await ctx.db.get(r.userId);
        email = user?.email ?? undefined;
      }
      if (!email) continue;
      out.push({ ruleId: String(r._id), email, name: r.name, severityThreshold: r.severityThreshold, isoA2: r.isoA2, category: r.category, keyword: r.keyword });
    }
    return out;
  },
});

/** Watchlist items with daily brief delivery enabled. */
export const dueWatchlistDigests = internalQuery({
  args: { hourUTC: v.number() },
  handler: async (ctx, args): Promise<DueWatch[]> => {
    const items = await ctx.db.query("watchlistItems").collect();
    const out: DueWatch[] = [];
    for (const item of items) {
      if (item.digestSchedule?.cadence !== "daily") continue;
      if (item.digestSchedule.hourUTC !== args.hourUTC) continue;
      const user = await ctx.db.get(item.userId);
      const email = user?.email ?? undefined;
      if (!email) continue;
      out.push({ itemId: String(item._id), email, label: item.label, type: item.type, value: item.value });
    }
    return out;
  },
});


/** Events in the last 24h at/above a severity threshold (digest payload). */
export const digestMatches = internalQuery({
  args: { severityThreshold: v.number(), isoA2: v.optional(v.string()), category: v.optional(v.string()), keyword: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - 24 * 3_600_000;
    const events = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", cutoff))
      .order("desc")
      .take(500);
    return events
      .filter((e: Doc<"events">) => {
        if (e.severity < args.severityThreshold) return false;
        if (args.isoA2 && e.isoA2 !== args.isoA2) return false;
        if (args.category && e.category !== args.category) return false;
        if (args.keyword) {
          const haystack = `${e.title} ${e.summary} ${(e.entities ?? []).join(" ")}`.toLowerCase();
          if (!haystack.includes(args.keyword.toLowerCase())) return false;
        }
        return true;
      })
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 20)
      .map((e) => ({ title: e.title, tier: e.tier, severity: e.severity, isoA2: e.isoA2, url: e.url ?? null }));
  },
});

export const watchlistMatches = internalQuery({
  args: { type: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - 24 * 3_600_000;
    const events = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", cutoff))
      .order("desc")
      .take(500);
    return events
      .filter((e: Doc<"events">) => {
        if (args.type === "region") return e.isoA2.toUpperCase() === args.value.toUpperCase();
        if (args.type === "entity") return (e.entities ?? []).some((x) => x.toLowerCase() === args.value.toLowerCase());
        if (args.type === "keyword") return `${e.title} ${e.summary} ${(e.entities ?? []).join(" ")}`.toLowerCase().includes(args.value.toLowerCase());
        return false;
      })
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 20)
      .map((e) => ({ title: e.title, tier: e.tier, severity: e.severity, isoA2: e.isoA2, url: e.url ?? null }));
  },
});


async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.AUTH_RESEND_KEY;
  const from = process.env.AUTH_EMAIL_FROM ?? "MAPR <noreply@mapr.app>";
  if (!key) return false; // config-gated: computed but not delivered without a key
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  return res.ok;
}

/** Cron entrypoint: compute + send all daily digests due this hour. */
export const runDailyDigests = internalAction({
  args: {},
  returns: v.object({ due: v.number(), sent: v.number() }),
  handler: async (ctx): Promise<{ due: number; sent: number }> => {
    const hourUTC = new Date().getUTCHours();
    const rules = await ctx.runQuery(internal.digests.dueDailyDigests, { hourUTC });
    const watches = await ctx.runQuery(internal.digests.dueWatchlistDigests, { hourUTC });
    let sent = 0;
    for (const rule of rules) {
      const matches = await ctx.runQuery(internal.digests.digestMatches, { severityThreshold: rule.severityThreshold, isoA2: rule.isoA2, category: rule.category, keyword: rule.keyword });
      if (matches.length === 0) continue;
      const rows = matches
        .map((m) => `<li><b>${m.tier.toUpperCase()} · ${m.severity.toFixed(1)}</b> — ${m.title} <i>(${m.isoA2 || "—"})</i></li>`)
        .join("");
      const scope = [rule.isoA2, rule.category, rule.keyword].filter(Boolean).join(" · ") || "global";
      const html = `<h2>MAPR daily digest — ${rule.name}</h2><p>${matches.length} events ≥ sev ${rule.severityThreshold} in the last 24h for ${scope}.</p><ul>${rows}</ul>`;
      const ok = await sendEmail(rule.email, `MAPR digest: ${matches.length} events`, html);
      if (ok) sent++;
    }
    for (const watch of watches) {
      const matches = await ctx.runQuery(internal.digests.watchlistMatches, { type: watch.type, value: watch.value });
      if (matches.length === 0) continue;
      const rows = matches
        .map((m) => `<li><b>${m.tier.toUpperCase()} · ${m.severity.toFixed(1)}</b> — ${m.title} <i>(${m.isoA2 || "—"})</i></li>`)
        .join("");
      const html = `<h2>MAPR watchlist brief — ${watch.label}</h2><p>${matches.length} matching events in the last 24h.</p><ul>${rows}</ul>`;
      const ok = await sendEmail(watch.email, `MAPR watchlist brief: ${watch.label}`, html);
      if (ok) sent++;
    }
    return { due: rules.length + watches.length, sent };
  },
});
