// Canonical article URLs: the exact-dedup key (articles.url is UNIQUE).

// Conservative: only parameters that are tracking by convention. Generic names
// such as id, cid, src or source are kept because some CMSs use them as the article key.
const DROP_EXACT = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id',
  'igshid', 'igsh', 'mkt_tok', 'vero_id', 'vero_conv', '_hsenc', '_hsmi', '__hstc', '__hssc', '__hsfp',
  'hsctatracking', '_ga', '_gl', '_openstat', 'ref', 'ref_src', 'ref_url', 'referrer', 'cmpid', 'ocid', 'ito',
  'xtor', 'smid', 'smtyp', 'sr_share', 's_cid', 'spm', 'icid', 'ncid', 'intcmp', 'ftag', 'guccounter',
  'guce_referrer', 'guce_referrer_sig', 'soc_src', 'soc_trk', 'tpcc', 'taid', 'mbid', 'cmp_id', 'rss_source',
]);
const DROP_PREFIX = ['utm_', 'mc_', 'pk_', 'piwik_', 'mtm_', 'matomo_', 'hsa_', 'vgo_', 'oly_', 'at_', 'ga_', 'ns_'];

export function isTrackingParam(name: string): boolean {
  const n = name.toLowerCase();
  return DROP_EXACT.has(n) || DROP_PREFIX.some((p) => n.startsWith(p));
}

export interface CanonicalOptions {
  /** Upgrade http:// links to https:// (only when the feed itself was served over https). */
  preferHttps?: boolean;
}

/**
 * Lowercase scheme and host (WHATWG URL does both, plus IDNA), drop the
 * fragment, drop tracking params, sort what is left, strip default ports and
 * a trailing slash on non-root paths. Returns null for non-http(s) input.
 */
export function canonicalUrl(raw: string, opts: CanonicalOptions = {}): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (opts.preferHttps && u.protocol === 'http:') {
    u.protocol = 'https:';
    if (u.port === '443') u.port = '';
  }
  u.hash = '';
  u.username = '';
  u.password = '';
  u.hostname = u.hostname.replace(/\.$/, '');
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';

  const kept = [...u.searchParams].filter(([k]) => k !== '' && !isTrackingParam(k));
  kept.sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  u.search = '';
  for (const [k, v] of kept) u.searchParams.append(k, v);

  let p = u.pathname.replace(/\/{2,}/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '') || '/';
  u.pathname = p;

  return u.href;
}
