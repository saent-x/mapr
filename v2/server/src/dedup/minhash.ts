// MinHash over word shingles of title + lead, with LSH banding for candidate lookup.
//
// 128 hashes in 32 bands of 4 rows. A pair with Jaccard J becomes a candidate
// with probability 1 - (1 - J^4)^32: ~0.99 at J=0.6, ~0.75 at J=0.4, ~0.23 at
// J=0.3, so candidates are then verified with the full signature estimate.

export const NUM_HASHES = 128;
export const BANDS = 32;
export const ROWS = NUM_HASHES / BANDS;
export const SHINGLE = 3;

function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix32(h);
}

// Fixed seeds (splitmix32 from a constant): signatures must stay comparable across restarts.
const SEEDS: Uint32Array = (() => {
  const out = new Uint32Array(NUM_HASHES);
  let x = 0x9e3779b9;
  for (let i = 0; i < NUM_HASHES; i++) {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    out[i] = (z ^ (z >>> 15)) >>> 0;
  }
  return out;
})();

export function tokenize(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function shingles(text: string, k = SHINGLE): Set<string> {
  const t = tokenize(text);
  const out = new Set<string>();
  if (t.length === 0) return out;
  if (t.length < k) {
    out.add(t.join(' '));
    return out;
  }
  for (let i = 0; i + k <= t.length; i++) out.add(t.slice(i, i + k).join(' '));
  return out;
}

/** 128 signed int32 values (Postgres int[]), or null when the text has no words. */
export function minhash(text: string): number[] | null {
  const sh = shingles(text);
  if (sh.size === 0) return null;
  const mins = new Uint32Array(NUM_HASHES).fill(0xffffffff);
  for (const s of sh) {
    const x = hash32(s);
    for (let i = 0; i < NUM_HASHES; i++) {
      const h = fmix32((x ^ SEEDS[i]!) >>> 0);
      if (h < mins[i]!) mins[i] = h;
    }
  }
  return Array.from(mins, (v) => v | 0);
}

/** Estimated Jaccard similarity from two signatures. */
export function similarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let eq = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) eq++;
  return eq / a.length;
}

/** One key per band: band * 2^32 + hash(rows). Fits in a JS number and a Postgres bigint. */
export function bandKeys(sig: readonly number[]): number[] {
  const keys: number[] = [];
  for (let b = 0; b < BANDS; b++) {
    let h = 0x811c9dc5 ^ b;
    for (let r = 0; r < ROWS; r++) {
      h = Math.imul(h ^ (sig[b * ROWS + r]! >>> 0), 0x01000193);
    }
    keys.push(b * 2 ** 32 + fmix32(h));
  }
  return keys;
}

export function dedupText(title: string, lead: string | null | undefined): string {
  return lead ? `${title} ${lead}` : title;
}
