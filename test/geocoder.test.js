import test from 'node:test';
import assert from 'node:assert/strict';
import { geocodeArticle, isoToCountry } from '../src/utils/geocoder.js';

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
