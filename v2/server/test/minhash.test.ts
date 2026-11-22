import { describe, expect, it } from 'vitest';
import { BANDS, bandKeys, minhash, NUM_HASHES, shingles, similarity, tokenize } from '../src/dedup/minhash.js';

const exactJaccard = (a: string, b: string) => {
  const A = shingles(a);
  const B = shingles(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
};

const base =
  'Magnitude 6.1 earthquake strikes off the coast of northern Chile. The quake struck at a depth of 35 km early on Tuesday, ' +
  'the US Geological Survey said, and cut power to tens of thousands of homes in the region around Antofagasta.';
const syndicated =
  'Magnitude 6.1 earthquake strikes off the coast of northern Chile. The quake struck at a depth of 35 km early on Tuesday, ' +
  'the US Geological Survey said, and cut power to tens of thousands of homes in the region around Antofagasta, officials added.';
const other =
  'Parliament passes budget after marathon session. Lawmakers approved the spending plan by a narrow margin late on Monday ' +
  'following weeks of negotiations between the coalition parties over defence and health funding.';

describe('tokenize / shingles', () => {
  it('lowercases, keeps unicode letters and digits', () => {
    expect(tokenize('Café-Strike: 2026 — São Paulo!')).toEqual(['café', 'strike', '2026', 'são', 'paulo']);
  });
  it('builds 3-word shingles, or one shingle for short texts', () => {
    expect([...shingles('a b c d')]).toEqual(['a b c', 'b c d']);
    expect([...shingles('just two')]).toEqual(['just two']);
    expect(shingles('  ...  ').size).toBe(0);
  });
});

describe('minhash', () => {
  it('produces 128 int32 values, deterministic', () => {
    const s = minhash(base)!;
    expect(s).toHaveLength(NUM_HASHES);
    expect(s.every((x) => Number.isInteger(x) && x >= -(2 ** 31) && x < 2 ** 31)).toBe(true);
    expect(minhash(base)).toEqual(s);
  });
  it('returns null for empty text', () => expect(minhash('')).toBeNull());
  it('identical text has similarity 1', () => expect(similarity(minhash(base)!, minhash(base)!)).toBe(1));
  it('estimates Jaccard within a reasonable error', () => {
    const est = similarity(minhash(base)!, minhash(syndicated)!);
    const truth = exactJaccard(base, syndicated);
    expect(truth).toBeGreaterThan(0.8);
    expect(Math.abs(est - truth)).toBeLessThan(0.12);
  });
  it('unrelated stories are far apart', () => {
    expect(similarity(minhash(base)!, minhash(other)!)).toBeLessThan(0.1);
  });
});

describe('LSH bands', () => {
  it('gives one key per band, tagged with the band index', () => {
    const k = bandKeys(minhash(base)!);
    expect(k).toHaveLength(BANDS);
    k.forEach((key, b) => {
      expect(Math.floor(key / 2 ** 32)).toBe(b);
      expect(Number.isSafeInteger(key)).toBe(true);
    });
  });
  it('near-duplicates share bands, unrelated texts do not', () => {
    const a = new Set(bandKeys(minhash(base)!));
    const shared = bandKeys(minhash(syndicated)!).filter((x) => a.has(x)).length;
    const unrelated = bandKeys(minhash(other)!).filter((x) => a.has(x)).length;
    expect(shared).toBeGreaterThan(5);
    expect(unrelated).toBe(0);
  });
});
