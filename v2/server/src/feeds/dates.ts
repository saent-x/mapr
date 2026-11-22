// Feed dates are messy: RFC 822/2822 with named zones, ISO 8601 with or
// without offsets, odd separators. Never trust a date that is in the future.

const ZONES: Record<string, number> = {
  UT: 0, UTC: 0, GMT: 0, Z: 0, WET: 0, BST: 60, IST: 330, CET: 60, CEST: 120, MET: 60, MEST: 120,
  EET: 120, EEST: 180, MSK: 180, EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360,
  PST: -480, PDT: -420, AKST: -540, AKDT: -480, HST: -600, JST: 540, KST: 540, AEST: 600, AEDT: 660,
  ACST: 570, AWST: 480, NZST: 720, NZDT: 780, SGT: 480, HKT: 480, PHT: 480, WIB: 420, PKT: 300,
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const FUTURE_TOLERANCE_MS = 60 * 60 * 1000;
const EARLIEST = Date.UTC(1995, 0, 1);

function offsetMinutes(tz: string | undefined): number | null {
  if (!tz) return 0;
  const t = tz.trim().toUpperCase();
  const m = t.match(/^(?:GMT|UTC)?([+-])(\d{1,2}):?(\d{2})?$/);
  if (m) return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  return t in ZONES ? ZONES[t]! : null;
}

function utc(y: number, mo: number, d: number, h: number, mi: number, s: number, offMin: number): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 24 || mi > 59 || s > 60) return null;
  if (y < 100) y += y < 70 ? 2000 : 1900;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s) - offMin * 60_000;
  return Number.isFinite(ms) ? ms : null;
}

/** RFC 2822: "Tue, 10 Jun 2003 04:00:00 GMT", tolerant of missing weekday/seconds and odd zones. */
function parseRfc2822(s: string): number | null {
  const m = s.match(
    /^(?:[A-Za-z]{2,9}\.?,?\s*)?(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?[\s-]+(\d{2,4})[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([A-Za-z]{1,5}|(?:GMT|UTC)?[+-]\d{1,2}:?\d{2})?/,
  );
  if (!m) return null;
  const mo = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1;
  if (mo === 0) return null;
  const off = offsetMinutes(m[7]);
  if (off === null) return null;
  return utc(Number(m[3]), mo, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0), off);
}

/** ISO 8601 / RFC 3339, including "2024-01-02 03:04:05", missing zone = UTC. */
function parseIso(s: string): number | null {
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[Tt\s]+(\d{2}):(\d{2})(?::(\d{2}))?(?:[.,]\d+)?\s*(Z|z|[+-]\d{2}:?\d{2}|[+-]\d{2})?)?$/,
  );
  if (!m) return null;
  const tz = m[7];
  const off = !tz || tz.toUpperCase() === 'Z' ? 0 : offsetMinutes(tz.length === 3 ? tz + '00' : tz);
  if (off === null) return null;
  return utc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), off);
}

/** GDELT compact: 20240102T030405Z */
function parseCompact(s: string): number | null {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return null;
  return utc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), 0);
}

/** Parse without the future clamp. Returns null on anything unrecognised. */
export function parseDateRaw(input: unknown): Date | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/\s+/g, ' ');
  if (!s) return null;
  const ms = parseIso(s) ?? parseRfc2822(s) ?? parseCompact(s) ?? fallback(s);
  return ms === null ? null : new Date(ms);
}

function fallback(s: string): number | null {
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Feed item date. Dates more than an hour in the future are clamped to `now`
 * (a typo'd year or a wrong zone must not keep an item "newest" for days).
 * Implausibly old or unparseable dates return null.
 */
export function parseFeedDate(input: unknown, now: Date = new Date()): Date | null {
  const d = parseDateRaw(input);
  if (!d) return null;
  const ms = d.getTime();
  if (ms < EARLIEST) return null;
  if (ms > now.getTime() + FUTURE_TOLERANCE_MS) return new Date(now.getTime());
  return d;
}
