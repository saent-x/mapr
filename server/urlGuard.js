/**
 * URL safety helpers — used to prevent SSRF when the server fetches
 * a caller-controlled URL (RSS feeds, source catalog adds, etc.).
 *
 * Blocks:
 *   - Non-http(s) schemes (file:, ftp:, gopher:, ssh:, ws:, etc.)
 *   - Loopback (127.0.0.0/8, ::1, localhost)
 *   - Link-local (169.254.0.0/16) — includes cloud metadata 169.254.169.254
 *   - RFC1918 private ranges (10/8, 172.16/12, 192.168/16)
 *   - Unique-local IPv6 (fc00::/7), IPv6 link-local (fe80::/10)
 *
 * IMPORTANT: This is a host-string check. If you can't trust DNS, also
 * resolve the URL and re-check the resolved IP before connecting (Node
 * does not expose connection-time IPs natively; consider `node:dns`).
 */

import net from 'node:net';

function ipv4InCidr(ip, base, bits) {
  const ipNum = ipv4ToInt(ip);
  const baseNum = ipv4ToInt(base);
  if (ipNum == null || baseNum == null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (ipNum & mask) === (baseNum & mask);
}

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function isPrivateOrReservedIPv4(ip) {
  return (
    ipv4InCidr(ip, '0.0.0.0', 8) ||
    ipv4InCidr(ip, '10.0.0.0', 8) ||
    ipv4InCidr(ip, '127.0.0.0', 8) ||
    ipv4InCidr(ip, '169.254.0.0', 16) ||
    ipv4InCidr(ip, '172.16.0.0', 12) ||
    ipv4InCidr(ip, '192.168.0.0', 16) ||
    ipv4InCidr(ip, '224.0.0.0', 4) ||
    ipv4InCidr(ip, '240.0.0.0', 4)
  );
}

function isPrivateOrReservedIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  // Link-local fe80::/10
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  // Unique-local fc00::/7
  if (/^f[cd][0-9a-f][0-9a-f]:/.test(lower)) return true;
  // IPv4-mapped: ::ffff:1.2.3.4 — re-check the embedded IPv4.
  // URL canonicalization rewrites the dotted form into hex (`::ffff:7f00:1`),
  // so handle both shapes.
  const mappedDotted = /^::ffff:([0-9.]+)$/.exec(lower);
  if (mappedDotted) return isPrivateOrReservedIPv4(mappedDotted[1]);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    if (Number.isFinite(high) && Number.isFinite(low)) {
      const ipv4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
      return isPrivateOrReservedIPv4(ipv4);
    }
  }
  return false;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
]);

/**
 * Returns true iff `value` parses as an http(s) URL whose host is a
 * public hostname or public IP. Returns false on anything suspicious.
 */
export function isPublicHttpUrl(value) {
  if (!value) return false;
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const rawHost = url.hostname.toLowerCase();
  if (!rawHost) return false;
  // URL.hostname keeps the literal IPv6 brackets; strip them so net.isIP can
  // recognize the address family.
  const host = rawHost.startsWith('[') && rawHost.endsWith(']')
    ? rawHost.slice(1, -1)
    : rawHost;
  if (BLOCKED_HOSTNAMES.has(host)) return false;

  // Reject IP-literal hosts in private ranges.
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    if (isPrivateOrReservedIPv4(host)) return false;
  } else if (ipVersion === 6) {
    if (isPrivateOrReservedIPv6(host)) return false;
  } else {
    // Hostname (DNS) — block obvious internal suffixes.
    if (host.endsWith('.local') || host.endsWith('.internal')) return false;
  }

  return true;
}
