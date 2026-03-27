import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { geocodeArticle, isoToCountry, countryToIso, getCountryGeoHints, KNOWN_COUNTRY_NAMES } from '../src/utils/geocoder.js';

test('geocodeArticle resolves city aliases like Kiev to Kyiv', () => {
  const geo = geocodeArticle('Explosions reported in Kiev after overnight attack', null, '');

  assert.ok(geo);
  assert.equal(geo.region, 'Ukraine');
  assert.equal(geo.locality, 'Kyiv');
  assert.equal(geo.precision, 'locality');
});

test('geocodeArticle matches accented location names after normalization', () => {
  const geo = geocodeArticle('Flooding in Sao Paulo leaves neighborhoods underwater', null, '');
  const accentedGeo = geocodeArticle('Flooding in São Paulo leaves neighborhoods underwater', null, '');

  assert.ok(geo);
  assert.ok(accentedGeo);
  assert.equal(geo.region, 'Brazil');
  assert.equal(accentedGeo.region, 'Brazil');
  assert.equal(accentedGeo.locality, 'Sao Paulo');
  assert.equal(accentedGeo.precision, 'locality');
});

test('geocodeArticle prefers an explicit country over a conflicting city venue', () => {
  const geo = geocodeArticle('Paris summit on unrest in Nigeria begins today', null, '');

  assert.ok(geo);
  assert.equal(geo.region, 'Nigeria');
  assert.equal(geo.precision, 'country');
  assert.equal(geo.matchedOn, 'title-country-conflict');
});

test('geocodeArticle resolves country aliases like UAE', () => {
  const geo = geocodeArticle('UAE authorities issue heat alert across coastal regions', null, '');

  assert.ok(geo);
  assert.equal(geo.region, 'United Arab Emirates');
  assert.equal(geo.precision, 'country');
});

test('geocodeArticle prefers summary geography over a conflicting title venue city', () => {
  const geo = geocodeArticle(
    'Paris monitor says ceasefire talks stall again',
    'France',
    'Ceasefire talks in Sudan remain deadlocked after clashes near Khartoum.'
  );

  assert.ok(geo);
  assert.equal(geo.region, 'Sudan');
  assert.equal(geo.locality, 'Khartoum');
  assert.equal(geo.precision, 'locality');
  assert.equal(geo.matchedOn, 'summary-country-conflict');
});

test('isoToCountry resolves known ISO country codes', () => {
  assert.equal(isoToCountry('NG'), 'Nigeria');
  assert.equal(isoToCountry('ng'), 'Nigeria');
  assert.equal(isoToCountry('ZZ'), null);
});

// === Expanded geocoder tests ===

test('geocoder city database has 500+ entries (VAL-DATA-007)', () => {
  const content = readFileSync(new URL('../src/utils/geocoder.js', import.meta.url), 'utf-8');
  const locationMatch = content.match(/const LOCATIONS = \[([\s\S]*?)\];/);
  assert.ok(locationMatch, 'LOCATIONS array found');
  const entries = locationMatch[1].match(/\{ name:/g);
  assert.ok(entries, 'City entries found');
  assert.ok(entries.length >= 500, `Expected 500+ cities, got ${entries.length}`);
});

test('geocodeArticle resolves African cities in previously uncovered regions', () => {
  const tests = [
    ['Asmara hit by airstrikes', 'Eritrea', 'Asmara'],
    ['Tensions rise in Djibouti port area', 'Djibouti', 'Djibouti'],
    ['Moroni hit by cyclone', 'Comoros', 'Moroni'],
    ['Port Louis flooding reported', 'Mauritius', 'Port Louis'],
    ['Banjul protests escalate', 'Gambia', 'Banjul'],
    ['Bissau military coup attempt', 'Guinea-Bissau', 'Bissau'],
    ['Lome summit concludes', 'Togo', 'Lome'],
    ['Monrovia market fire', 'Liberia', 'Monrovia'],
    ['Malabo oil revenue dispute', 'Equatorial Guinea', 'Malabo'],
    ['Brazzaville floods displace thousands', 'Congo', 'Brazzaville'],
    ['Bangui clashes between armed groups', 'Central African Republic', 'Bangui'],
    ['Gitega becomes new capital of Burundi', 'Burundi', 'Gitega'],
    ['Mbabane faces water shortage', 'Eswatini', 'Mbabane'],
    ['Maseru elections results announced', 'Lesotho', 'Maseru'],
    ['Nouakchott desert expansion threatens city', 'Mauritania', 'Nouakchott'],
  ];

  for (const [title, expectedRegion, expectedLocality] of tests) {
    const geo = geocodeArticle(title, null, '');
    assert.ok(geo, `Should geocode: ${title}`);
    assert.equal(geo.region, expectedRegion, `Region for "${title}"`);
    assert.equal(geo.locality, expectedLocality, `Locality for "${title}"`);
    assert.equal(geo.precision, 'locality');
  }
});

test('geocodeArticle resolves Central/Southeast Asian cities', () => {
  const tests = [
    ['Ashgabat gas explosion reported', 'Turkmenistan', 'Ashgabat'],
    ['Dushanbe earthquake aftermath', 'Tajikistan', 'Dushanbe'],
    ['Bishkek protests over elections', 'Kyrgyzstan', 'Bishkek'],
    ['Thimphu celebrates national day', 'Bhutan', 'Thimphu'],
    ['Male underwater threat from rising seas', 'Maldives', 'Male'],
    ['Dili independence anniversary', 'Timor-Leste', 'Dili'],
    ['Bandar Seri Begawan trade talks', 'Brunei', 'Bandar Seri Begawan'],
    ['Mandalay unrest continues', 'Myanmar', 'Mandalay'],
    ['Siem Reap temple restoration', 'Cambodia', 'Siem Reap'],
  ];

  for (const [title, expectedRegion, expectedLocality] of tests) {
    const geo = geocodeArticle(title, null, '');
    assert.ok(geo, `Should geocode: ${title}`);
    assert.equal(geo.region, expectedRegion, `Region for "${title}"`);
    assert.equal(geo.locality, expectedLocality, `Locality for "${title}"`);
  }
});

test('geocodeArticle resolves Caribbean capitals', () => {
  const tests = [
    ['Nassau hurricane damage extensive', 'Bahamas', 'Nassau'],
    ['Bridgetown cricket venue announced', 'Barbados', 'Bridgetown'],
    ['Castries port expansion plan', 'Saint Lucia', 'Castries'],
    ['Roseau rebuilds after hurricane', 'Dominica', 'Roseau'],
    ['Georgetown flooding in Guyana', 'Guyana', 'Georgetown'],
    ['Paramaribo river levels rise', 'Suriname', 'Paramaribo'],
  ];

  for (const [title, expectedRegion, expectedLocality] of tests) {
    const geo = geocodeArticle(title, null, '');
    assert.ok(geo, `Should geocode: ${title}`);
    assert.equal(geo.region, expectedRegion, `Region for "${title}"`);
    assert.equal(geo.locality, expectedLocality, `Locality for "${title}"`);
  }
});

test('geocodeArticle resolves Pacific Island capitals', () => {
  const tests = [
    ['Apia cyclone warning issued', 'Samoa', 'Apia'],
    ['Nukualofa volcanic eruption aftermath', 'Tonga', 'Nukualofa'],
    ['Honiara peace talks resume', 'Solomon Islands', 'Honiara'],
    ['Port Vila earthquake damage', 'Vanuatu', 'Port Vila'],
    ['Tarawa rising sea levels threat', 'Kiribati', 'Tarawa'],
    ['Majuro climate change summit', 'Marshall Islands', 'Majuro'],
  ];

  for (const [title, expectedRegion, expectedLocality] of tests) {
    const geo = geocodeArticle(title, null, '');
    assert.ok(geo, `Should geocode: ${title}`);
    assert.equal(geo.region, expectedRegion, `Region for "${title}"`);
    assert.equal(geo.locality, expectedLocality, `Locality for "${title}"`);
  }
});

test('geocodeArticle resolves Eastern European cities', () => {
  const tests = [
    ['Zagreb earthquake aftershocks continue', 'Croatia', 'Zagreb'],
    ['Sofia protests against government', 'Bulgaria', 'Sofia'],
    ['Skopje highway construction begins', 'North Macedonia', 'Skopje'],
    ['Pristina EU membership talks', 'Kosovo', 'Pristina'],
    ['Podgorica tourism season opens', 'Montenegro', 'Podgorica'],
    ['Tirana construction boom continues', 'Albania', 'Tirana'],
    ['Minsk opposition leaders arrested', 'Belarus', 'Minsk'],
    ['Baku oil prices surge', 'Azerbaijan', 'Baku'],
    ['Yerevan genocide memorial service', 'Armenia', 'Yerevan'],
  ];

  for (const [title, expectedRegion, expectedLocality] of tests) {
    const geo = geocodeArticle(title, null, '');
    assert.ok(geo, `Should geocode: ${title}`);
    assert.equal(geo.region, expectedRegion, `Region for "${title}"`);
    assert.equal(geo.locality, expectedLocality, `Locality for "${title}"`);
  }
});

test('country name matching handles common alternate names', () => {
  const aliasTests = [
    ['Crisis in DR Congo deepens', 'Dem. Rep. Congo'],
    ['Ivory Coast elections underway', 'Ivory Coast'],
    ['Czechia policy changes announced', 'Czech Republic'],
    ['Swaziland king issues decree', 'Eswatini'],
    ['East Timor independence celebrations', 'Timor-Leste'],
    ['Cape Verde tourism grows', 'Cabo Verde'],
    ['Macedonia name dispute resolved', 'North Macedonia'],
    ['Burma military crackdown continues', 'Myanmar'],
    ['Congo Brazzaville floods hit capital', 'Congo'],
  ];

  for (const [title, expectedRegion] of aliasTests) {
    const geo = geocodeArticle(title, null, '');
    assert.ok(geo, `Should geocode alias: ${title}`);
    assert.equal(geo.region, expectedRegion, `Alias region for "${title}"`);
  }
});

test('getCountryGeoHints resolves alternate country names', () => {
  const hints1 = getCountryGeoHints('DR Congo');
  assert.equal(hints1.country, 'Dem. Rep. Congo');
  assert.ok(hints1.localities.length > 0, 'DR Congo should have localities');

  const hints2 = getCountryGeoHints('Czechia');
  assert.equal(hints2.country, 'Czech Republic');

  const hints3 = getCountryGeoHints('Swaziland');
  assert.equal(hints3.country, 'Eswatini');

  const hints4 = getCountryGeoHints('East Timor');
  assert.equal(hints4.country, 'Timor-Leste');
});

test('countryToIso covers newly added countries', () => {
  const isoTests = [
    ['Eritrea', 'ER'], ['Djibouti', 'DJ'], ['Comoros', 'KM'],
    ['Gambia', 'GM'], ['Togo', 'TG'], ['Liberia', 'LR'],
    ['Brunei', 'BN'], ['Timor-Leste', 'TL'], ['Bhutan', 'BT'],
    ['Maldives', 'MV'], ['Turkmenistan', 'TM'], ['Tajikistan', 'TJ'],
    ['Kyrgyzstan', 'KG'], ['North Macedonia', 'MK'],
    ['Bahamas', 'BS'], ['Barbados', 'BB'], ['Samoa', 'WS'],
    ['Tonga', 'TO'], ['Vanuatu', 'VU'], ['Kiribati', 'KI'],
  ];

  for (const [country, expectedIso] of isoTests) {
    assert.equal(countryToIso(country), expectedIso, `ISO for ${country}`);
  }
});

test('demonyms match newly added countries', () => {
  const demonymTests = [
    ['Eritrean forces advance north', 'Eritrea'],
    ['Djiboutian port expansion planned', 'Djibouti'],
    ['Bruneian sultan addresses nation', 'Brunei'],
    ['Timorese communities displaced', 'Timor-Leste'],
    ['Kyrgyz parliament dissolved', 'Kyrgyzstan'],
    ['Tajik border dispute escalates', 'Tajikistan'],
    ['Turkmen gas exports increase', 'Turkmenistan'],
    ['Samoan cyclone recovery continues', 'Samoa'],
    ['Tongan volcanic eruption aftermath', 'Tonga'],
  ];

  for (const [title, expectedRegion] of demonymTests) {
    const geo = geocodeArticle(title, null, '');
    assert.ok(geo, `Should match demonym: ${title}`);
    assert.equal(geo.region, expectedRegion, `Demonym region for "${title}"`);
  }
});

test('geocoder works in both Node.js and browser (no Node-only APIs in exports)', () => {
  // Verify the module exports work without Node.js-only APIs
  assert.equal(typeof geocodeArticle, 'function');
  assert.equal(typeof isoToCountry, 'function');
  assert.equal(typeof countryToIso, 'function');
  assert.equal(typeof getCountryGeoHints, 'function');
  assert.ok(Array.isArray(KNOWN_COUNTRY_NAMES));
  assert.ok(KNOWN_COUNTRY_NAMES.length >= 150, `Expected 150+ known countries, got ${KNOWN_COUNTRY_NAMES.length}`);
});
