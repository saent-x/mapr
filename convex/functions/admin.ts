import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./lib/access";

// ── SSRF guard (write-time) ──
// Faithful port of the worker's `is_public_http_url` (ingestor/src/ssrf.rs):
// catalog URLs are validated here at WRITE time so an internal/private target
// never enters the catalog, in addition to the worker's per-fetch DNS guard.
// This is the pure string/IP-literal layer (no DNS — the V8 runtime can't
// resolve hosts; the worker re-validates resolved IPs at fetch time).

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);

/** True if `ipv4` (already-validated octets) is in a private/reserved range. */
function isPrivateOrReservedIpv4(octets: number[]): boolean {
  const inCidr = (base: number[], bits: number): boolean => {
    if (bits === 0) return true;
    const ipN = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
    const baseN = ((base[0] << 24) | (base[1] << 16) | (base[2] << 8) | base[3]) >>> 0;
    const mask = bits >= 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
    return (ipN & mask) >>> 0 === (baseN & mask) >>> 0;
  };
  return (
    inCidr([0, 0, 0, 0], 8) || // "this network"
    inCidr([10, 0, 0, 0], 8) || // RFC1918
    inCidr([127, 0, 0, 0], 8) || // loopback
    inCidr([169, 254, 0, 0], 16) || // link-local + cloud metadata
    inCidr([172, 16, 0, 0], 12) || // RFC1918
    inCidr([192, 168, 0, 0], 16) || // RFC1918
    inCidr([224, 0, 0, 0], 4) || // multicast
    inCidr([240, 0, 0, 0], 4) // reserved
  );
}

/** Parse a dotted-quad IPv4 string to octets, or null if not a valid IPv4. */
function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/**
 * Returns true iff `value` is an http(s) URL whose host is a public hostname or
 * public IP literal. Mirrors the worker's `is_public_http_url` policy: blocks
 * non-http(s) schemes; loopback/RFC1918/link-local/multicast/reserved IPv4;
 * IPv6 loopback/unspecified/unique-local/link-local and IPv4-mapped private v6;
 * and localhost / *.local / *.internal / metadata hostnames.
 */
export function isPublicHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  let host = url.hostname;
  if (!host) return false;

  // IPv6 literal: URL.hostname keeps the surrounding brackets (e.g. "[::1]").
  if (host.startsWith("[") && host.endsWith("]")) {
    return !isPrivateOrReservedIpv6(host.slice(1, -1));
  }

  // IPv4 literal.
  const v4 = parseIpv4(host);
  if (v4) return !isPrivateOrReservedIpv4(v4);

  // Domain name.
  host = host.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return false;
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  return true;
}

/** True if the IPv6 literal string is loopback/ULA/link-local/v4-mapped-private. */
function isPrivateOrReservedIpv6(host: string): boolean {
  // Normalize: lowercase, drop any zone id (fe80::1%eth0).
  const addr = host.toLowerCase().split("%")[0];
  const groups = expandIpv6(addr);
  if (!groups) return true; // unparseable → treat as unsafe
  if (groups.every((g) => g === 0)) return true; // :: (unspecified)
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1 loopback
  // IPv4-mapped ::ffff:a.b.c.d → re-check the embedded IPv4.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const v4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff];
    return isPrivateOrReservedIpv4(v4);
  }
  const seg0 = groups[0];
  if ((seg0 & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((seg0 & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  return false;
}

/** Expand an IPv6 string (possibly with "::" or a trailing dotted-v4) to 8 u16 groups, or null. */
function expandIpv6(addr: string): number[] | null {
  // A trailing dotted-quad (::ffff:127.0.0.1) becomes two hex groups, appended
  // as the address's last two segments BEFORE "::" expansion.
  let segText = addr;
  let v4Tail: number[] = [];
  const lastColon = segText.lastIndexOf(":");
  const afterColon = segText.slice(lastColon + 1);
  if (afterColon.includes(".")) {
    const v4 = parseIpv4(afterColon);
    if (!v4) return null;
    v4Tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    segText = segText.slice(0, lastColon + 1); // keep the trailing ":"
  }

  const parts = segText.split("::");
  if (parts.length > 2) return null;
  const toNums = (raw: string): number[] | null => {
    if (raw === "") return [];
    const out: number[] = [];
    for (const s of raw.split(":")) {
      if (s === "") return null; // stray empty segment (only "::" may elide)
      if (!/^[0-9a-f]{1,4}$/.test(s)) return null;
      out.push(parseInt(s, 16));
    }
    return out;
  };

  if (parts.length === 1) {
    // No "::" — must total exactly 8 groups including the v4 tail.
    const head = toNums(parts[0].replace(/:$/, ""));
    if (head === null) return null;
    const all = [...head, ...v4Tail];
    return all.length === 8 ? all : null;
  }

  const head = toNums(parts[0]);
  const rest = toNums(parts[1].replace(/:$/, ""));
  if (head === null || rest === null) return null;
  const explicit = head.length + rest.length + v4Tail.length;
  if (explicit > 7) return null; // "::" must elide at least one group
  const fill = new Array(8 - explicit).fill(0);
  return [...head, ...fill, ...rest, ...v4Tail];
}

/** Throw a clear error if `url` is not a public http(s) URL (SSRF guard). */
export function assertPublicSourceUrl(url: string): void {
  if (!isPublicHttpUrl(url)) {
    throw new Error("INVALID_SOURCE_URL");
  }
}

// ── Source catalog (admin) ──
export const listSources = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("sourceCatalog").order("desc").collect();
  },
});

export const addSource = mutation({
  args: {
    name: v.string(),
    url: v.string(),
    kind: v.union(v.literal("gdelt"), v.literal("rss"), v.literal("html"), v.literal("bluesky")),
    region: v.optional(v.string()),
    category: v.optional(v.string()),
    sourceType: v.optional(v.union(
      v.literal("wire"),
      v.literal("regional"),
      v.literal("official"),
      v.literal("ngo"),
      v.literal("social"),
      v.literal("user"),
      v.literal("other"),
    )),
    verificationLevel: v.optional(v.union(v.literal("verified"), v.literal("mixed"), v.literal("unverified"))),
    countryOfOrigin: v.optional(v.string()),
    language: v.optional(v.string()),
    coverageRegion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    // Validate at write time so an internal/private target never enters the
    // catalog (the worker also re-validates resolved IPs at fetch time).
    assertPublicSourceUrl(args.url);
    const existing = await ctx.db
      .query("sourceCatalog")
      .withIndex("by_url", (q) => q.eq("url", args.url))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("sourceCatalog", {
      name: args.name,
      url: args.url,
      kind: args.kind,
      enabled: true,
      region: args.region,
      category: args.category,
      sourceType: args.sourceType,
      verificationLevel: args.verificationLevel,
      countryOfOrigin: args.countryOfOrigin,
      language: args.language,
      coverageRegion: args.coverageRegion,
      consecutiveFailures: 0,
      fetchCount: 0,
      itemCount: 0,
      createdAt: Date.now(),
    });
  },
});

export const setSourceEnabled = mutation({
  args: { id: v.id("sourceCatalog"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.patch(args.id, { enabled: args.enabled });
    return { ok: true };
  },
});

export const removeSource = mutation({
  args: { id: v.id("sourceCatalog") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

// ── Public source catalog (Feeds drawer) — read-only, no auth, no secrets ──
export const publicSources = query({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.db.query("sourceCatalog").order("desc").collect();
    return sources
      .filter((s) => s.enabled)
      .map((s) => ({
        id: s._id,
        name: s.name,
        kind: s.kind,
        sourceType: s.sourceType ?? "other",
        itemCount: s.itemCount,
        consecutiveFailures: s.consecutiveFailures,
        lastStatus: s.lastStatus ?? "—",
      }));
  },
});

// ── Feature flags ──
// Public flag keys exposed to the UNAUTHENTICATED query below. Add a key here
// only when the client legitimately needs to read it pre-auth. Everything else
// (internal/operational toggles, descriptions, timestamps) stays admin-only via
// `adminFeatureFlags`. Keep this list narrow.
const PUBLIC_FEATURE_FLAGS = new Set<string>([
  "agentChat",
  "trends",
  "intel",
  "entities",
  "billing",
  "sourceRequests",
]);

export const featureFlags = query({
  args: {},
  handler: async (ctx) => {
    // Public-readable: the UI reads flags without auth, so return ONLY the
    // allowlisted public keys with their boolean values — never descriptions,
    // timestamps, or non-public keys.
    const rows = await ctx.db.query("featureFlags").collect();
    return rows
      .filter((f) => PUBLIC_FEATURE_FLAGS.has(f.key))
      .map((f) => ({ key: f.key, value: f.value }));
  },
});

/** Full flag table for the admin management UI (admin-guarded). */
export const adminFeatureFlags = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("featureFlags").order("desc").collect();
  },
});

export const setFeatureFlag = mutation({
  args: { key: v.string(), value: v.boolean(), description: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value, description: args.description, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("featureFlags", { key: args.key, value: args.value, description: args.description, updatedAt: now });
  },
});

// ── On-demand ingest trigger ──
export const requestRefresh = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const sig = await ctx.db
      .query("controlSignals")
      .withIndex("by_key", (q) => q.eq("key", "refreshRequested"))
      .unique();
    const now = Date.now();
    if (sig) {
      await ctx.db.patch(sig._id, { value: true, requestedBy: admin.email ?? admin._id, requestedAt: now });
    } else {
      await ctx.db.insert("controlSignals", { key: "refreshRequested", value: true, requestedBy: admin.email ?? admin._id, requestedAt: now });
    }
    return { ok: true };
  },
});

// ── Ingestion health dashboard ──
export const health = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const sources = await ctx.db.query("sourceCatalog").collect();
    const now = Date.now();
    const recentEvents = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", now - 6 * 3_600_000))
      .collect();
    const tierCount = { green: 0, amber: 0, red: 0, black: 0 };
    for (const e of recentEvents) tierCount[e.tier]++;
    return {
      sources: {
        total: sources.length,
        enabled: sources.filter((s) => s.enabled).length,
        degraded: sources.filter((s) => s.consecutiveFailures > 0).length,
      },
      events6h: recentEvents.length,
      tierCount,
      sourceRows: sources.map((s) => ({
        id: s._id,
        name: s.name,
        url: s.url,
        kind: s.kind,
        enabled: s.enabled,
        lastStatus: s.lastStatus ?? "—",
        lastFetchedAt: s.lastFetchedAt ?? null,
        consecutiveFailures: s.consecutiveFailures,
        itemCount: s.itemCount,
      })),
    };
  },
});
