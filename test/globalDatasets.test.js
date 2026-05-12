/**
 * Pin global coverage of editorial-bias datasets so a future contributor
 * can't quietly narrow them to one region.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

describe('stateAffiliatedNetworks dataset', () => {
  const data = JSON.parse(readFileSync(join(ROOT, 'src/data/stateAffiliatedNetworks.json'), 'utf8'));

  it('declares its sources', () => {
    assert.ok(Array.isArray(data.metadata?.sources) && data.metadata.sources.length >= 2,
      'must list at least 2 attribution sources for auditability');
    for (const s of data.metadata.sources) {
      assert.ok(s.name && s.url, 'each source must have name + url');
    }
  });

  it('covers state media from every populated region (no single-region bias)', () => {
    const countries = new Set(data.networks.map((n) => n.country));
    // At minimum we expect coverage of multiple regions:
    //   Europe (RU/HU), Asia (CN/IR/KP/VN/MM), Africa (ER/EG/SD),
    //   Americas (CU/VE), Middle East (SA/AE/QA), Central Asia (TM/UZ/AZ).
    const required = ['RU', 'CN', 'IR', 'KP', 'VN', 'CU', 'VE', 'SA', 'AE', 'EG', 'BY', 'MM'];
    for (const iso of required) {
      assert.ok(countries.has(iso),
        `missing state-affiliated network for ${iso} — adding new outlets must preserve global balance`);
    }
    assert.ok(countries.size >= 15, `expected ≥15 countries covered, got ${countries.size}`);
  });

  it('uses the documented categories', () => {
    const allowed = new Set(['state-controlled', 'state-affiliated', 'publicly-funded']);
    for (const n of data.networks) {
      assert.ok(allowed.has(n.category), `unknown category for ${n.name}: ${n.category}`);
    }
  });
});

describe('pressFreedom dataset', () => {
  const data = JSON.parse(readFileSync(join(ROOT, 'src/data/pressFreedom.json'), 'utf8'));

  it('cites RSF as the source', () => {
    assert.match(data.metadata?.source || '', /Reporters Without Borders/);
    assert.ok(data.metadata?.url, 'must include source URL');
    assert.ok(data.metadata?.version, 'must include dataset version');
  });

  it('covers a broad set of countries across all regions', () => {
    const isoSet = new Set(data.countries.map((c) => c.iso));
    // Sample one country per region — any of these missing means the
    // dataset has been narrowed and global coverage is broken.
    const required = [
      'NO', 'DE', 'GB', 'IT', 'PL',           // Europe
      'US', 'CA', 'MX', 'BR', 'AR',           // Americas
      'CN', 'JP', 'IN', 'PK', 'TH',           // Asia
      'KE', 'NG', 'ZA', 'EG', 'ET',           // Africa
      'AU', 'NZ', 'PG',                        // Oceania
      'SA', 'IR', 'IL', 'AE',                  // Middle East
      'KP', 'TM', 'ER', 'SY', 'AF',           // Restricted (silence detector)
    ];
    for (const iso of required) {
      assert.ok(isoSet.has(iso), `pressFreedom dataset missing ${iso}`);
    }
    assert.ok(data.countries.length >= 100,
      `expected ≥100 countries in dataset, got ${data.countries.length}`);
  });

  it('uses the documented tier vocabulary', () => {
    const allowed = new Set(['good', 'satisfactory', 'problematic', 'difficult', 'serious', 'very-serious']);
    for (const c of data.countries) {
      assert.ok(allowed.has(c.tier), `unknown tier for ${c.iso}: ${c.tier}`);
    }
  });
});

describe('silenceDetector wired to pressFreedom dataset', () => {
  it('isRestrictedCountry flags very-serious tier countries', async () => {
    const { isRestrictedCountry, getRestrictedCountryEvidence } = await import('../src/utils/silenceDetector.js');
    assert.equal(isRestrictedCountry('KP'), true);
    assert.equal(isRestrictedCountry('ER'), true);
    assert.equal(isRestrictedCountry('TM'), true);
    assert.equal(isRestrictedCountry('NO'), false);
    assert.equal(isRestrictedCountry('US'), false);
    assert.equal(isRestrictedCountry(null), false);
  });

  it('getRestrictedCountryEvidence returns provenance for tooltip', async () => {
    const { getRestrictedCountryEvidence } = await import('../src/utils/silenceDetector.js');
    const evidence = getRestrictedCountryEvidence('KP');
    assert.ok(evidence, 'must return evidence for restricted country');
    assert.ok(evidence.source && evidence.sourceUrl);
    assert.ok(typeof evidence.score === 'number');
  });
});

describe('amplificationDetector wired to global state-media dataset', () => {
  it('groups Russian state media into a single network key', async () => {
    const { _getStateNetworkOverrides } = await import('../src/utils/amplificationDetector.js');
    const overrides = _getStateNetworkOverrides();
    assert.equal(overrides.get('rt'), 'state-media-ru');
    assert.equal(overrides.get('tass'), 'state-media-ru');
    assert.equal(overrides.get('sputnik'), 'state-media-ru');
  });

  it('groups Chinese state media into a single network key', async () => {
    const { _getStateNetworkOverrides } = await import('../src/utils/amplificationDetector.js');
    const overrides = _getStateNetworkOverrides();
    assert.equal(overrides.get('xinhua'), 'state-media-cn');
    assert.equal(overrides.get('cgtn'), 'state-media-cn');
    assert.equal(overrides.get('global times'), 'state-media-cn');
  });

  it('groups Iranian state media into a single network key', async () => {
    const { _getStateNetworkOverrides } = await import('../src/utils/amplificationDetector.js');
    const overrides = _getStateNetworkOverrides();
    assert.equal(overrides.get('press tv'), 'state-media-ir');
    assert.equal(overrides.get('irna'), 'state-media-ir');
  });

  it('amplification flags repeated state-media output across regions', async () => {
    const { detectAmplification } = await import('../src/utils/amplificationDetector.js');
    // 5 articles published within 30 minutes from 2 PRC outlets sharing tokens.
    const now = new Date();
    const articles = [
      { source: 'Xinhua', publishedAt: now.toISOString(), title: 'Border tensions rise as troops mobilize' },
      { source: 'CGTN', publishedAt: new Date(now - 5 * 60_000).toISOString(), title: 'Border tensions rise as troops mobilize' },
      { source: 'CCTV', publishedAt: new Date(now - 10 * 60_000).toISOString(), title: 'Border tensions rise as troops mobilize today' },
      { source: 'People\'s Daily', publishedAt: new Date(now - 15 * 60_000).toISOString(), title: 'Border tensions rise as troops mobilize' },
      { source: 'Global Times', publishedAt: new Date(now - 20 * 60_000).toISOString(), title: 'Border tensions rise as troops mobilize' },
    ];
    const result = detectAmplification(articles);
    assert.equal(result.isAmplified, true,
      'must flag coordinated PRC state-media amplification (was previously RU-only)');
  });
});
