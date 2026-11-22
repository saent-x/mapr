// SSRF guard for everything the poller fetches (feed URLs and every redirect hop).
//
// Layers:
//  1. checkUrl(): scheme http/https, port 80/443 only, no credentials, no
//     internal-looking hostnames, IP literals must be public.
//  2. assertPublicUrl(): resolves the host and refuses if ANY address is
//     non-public (a mixed answer is treated as hostile).
//  3. guardedLookup(): the same check inside the socket's DNS lookup, so the
//     address we connect to is the address we checked (no rebinding window).
//     IP-literal hosts skip lookup in net.connect, which is why layer 1 checks them.

import dns from 'node:dns';
import net from 'node:net';

export class SsrfError extends Error {
  override name = 'SsrfError';
}

/** The host could not be resolved: an ordinary fetch failure, not a policy refusal. */
export class DnsError extends Error {
  override name = 'DnsError';
}

const BLOCKED_NAMES = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal', 'metadata']);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet', '.corp'];

let extraBlocked: string[] = ['stbrn.studio'];

/** Extra hostnames (and their subdomains) never to fetch, e.g. our own zone. */
export function setBlockedHosts(hosts: string[]): void {
  extraBlocked = hosts.map((h) => h.trim().toLowerCase().replace(/^\.+/, '')).filter(Boolean);
}

type Cidr4 = [number, number];
const V4_BLOCKED: Cidr4[] = (
  [
    ['0.0.0.0', 8], // "this network"
    ['10.0.0.0', 8], // RFC1918
    ['100.64.0.0', 10], // CGNAT
    ['127.0.0.0', 8], // loopback
    ['169.254.0.0', 16], // link-local, cloud metadata
    ['172.16.0.0', 12], // RFC1918
    ['192.0.0.0', 24], // IETF protocol assignments
    ['192.0.2.0', 24], // TEST-NET-1
    ['192.88.99.0', 24], // 6to4 relay anycast
    ['192.168.0.0', 16], // RFC1918
    ['198.18.0.0', 15], // benchmarking
    ['198.51.100.0', 24], // TEST-NET-2
    ['203.0.113.0', 24], // TEST-NET-3
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4], // reserved + broadcast
  ] as const
).map(([a, bits]) => [v4ToInt(a), bits]);

function v4ToInt(a: string): number {
  const p = a.split('.').map(Number);
  return (((p[0]! << 24) >>> 0) + (p[1]! << 16) + (p[2]! << 8) + p[3]!) >>> 0;
}

export function isBlockedIPv4(addr: string): boolean {
  if (net.isIPv4(addr) === false) return true;
  const n = v4ToInt(addr);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((base & mask) >>> 0);
  });
}

/** Expand an IPv6 address into 8 16-bit groups (handles ::, embedded IPv4, zone ids). */
export function expandIPv6(input: string): number[] | null {
  let a = input.replace(/^\[|\]$/g, '').split('%')[0]!;
  if (!net.isIPv6(a)) return null;
  // Embedded dotted IPv4 tail.
  const m = a.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const n = v4ToInt(m[1]!);
    a = a.slice(0, -m[1]!.length) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16);
  }
  const [head, tail] = a.split('::') as [string, string | undefined];
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const fill = a.includes('::') ? 8 - h.length - t.length : 0;
  const groups = [...h, ...Array(fill).fill('0'), ...t].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

export function isBlockedIPv6(addr: string): boolean {
  const g = expandIPv6(addr);
  if (!g) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  const embedded = () => `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
  const zero = (...xs: number[]) => xs.every((x) => x === 0);
  if (zero(g0, g1, g2, g3, g4, g5, g6) && (g7 === 0 || g7 === 1)) return true; // :: and ::1
  if (zero(g0, g1, g2, g3, g4) && g5 === 0xffff) return isBlockedIPv4(embedded()); // ::ffff:a.b.c.d
  if (zero(g0, g1, g2, g3, g4, g5)) return true; // deprecated IPv4-compatible ::a.b.c.d
  if (g0 === 0x64 && g1 === 0xff9b && zero(g2, g3, g4, g5)) return isBlockedIPv4(embedded()); // NAT64
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return true; // local-use NAT64
  if (g0 === 0x0100 && zero(g1, g2, g3)) return true; // discard-only 100::/64
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x2001 && g1 < 0x0200) return true; // IETF protocol assignments incl. Teredo
  if (g0 === 0x2002) return true; // 6to4 (embeds arbitrary IPv4)
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g0 & 0xffc0) === 0xfec0) return true; // site-local fec0::/10
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  return false;
}

export function isBlockedIp(addr: string): boolean {
  const fam = net.isIP(addr.replace(/^\[|\]$/g, '').split('%')[0]!);
  if (fam === 4) return isBlockedIPv4(addr);
  if (fam === 6) return isBlockedIPv6(addr);
  return true;
}

function hostnameBlocked(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h || BLOCKED_NAMES.has(h)) return true;
  if (BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) return true;
  if (!h.includes('.')) return true; // single-label names resolve via search domains
  if (extraBlocked.some((b) => h === b || h.endsWith('.' + b))) return true;
  return false;
}

/** Synchronous checks on the URL itself. Returns the parsed URL. */
export function checkUrl(raw: string | URL): URL {
  let u: URL;
  try {
    u = typeof raw === 'string' ? new URL(raw) : raw;
  } catch {
    throw new SsrfError('invalid url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new SsrfError(`scheme not allowed: ${u.protocol}`);
  if (u.username || u.password) throw new SsrfError('credentials in url');
  if (u.port !== '' && u.port !== '80' && u.port !== '443') throw new SsrfError(`port not allowed: ${u.port}`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfError(`address not allowed: ${host}`);
  } else if (hostnameBlocked(host)) {
    throw new SsrfError(`host not allowed: ${host}`);
  }
  return u;
}

export type Resolver = (host: string) => Promise<string[]>;

export const systemResolver: Resolver = async (host) =>
  (await dns.promises.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** checkUrl() plus DNS: every resolved address must be public. */
export async function assertPublicUrl(raw: string | URL, resolve: Resolver = systemResolver): Promise<URL> {
  const u = checkUrl(raw);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return u;
  let addrs: string[];
  try {
    addrs = await resolve(host);
  } catch (err) {
    throw new DnsError(`dns lookup failed for ${host}: ${(err as Error).message}`);
  }
  if (addrs.length === 0) throw new DnsError(`no addresses for ${host}`);
  const bad = addrs.find(isBlockedIp);
  if (bad) throw new SsrfError(`${host} resolves to non-public address ${bad}`);
  return u;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/** Drop-in for net.connect's `lookup` option that refuses non-public answers. */
export function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCb): void {
  if (hostnameBlocked(hostname)) {
    callback(Object.assign(new SsrfError(`host not allowed: ${hostname}`), { code: 'ESSRF' }), '', 0);
    return;
  }
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return callback(err, '', 0);
    const list = addrs as dns.LookupAddress[];
    const bad = list.find((a) => isBlockedIp(a.address));
    if (!list.length || bad) {
      return callback(
        Object.assign(new SsrfError(`${hostname} resolves to non-public address ${bad?.address ?? '(none)'}`), {
          code: 'ESSRF',
        }),
        '',
        0,
      );
    }
    if (options.all) callback(null, list);
    else callback(null, list[0]!.address, list[0]!.family);
  });
}
