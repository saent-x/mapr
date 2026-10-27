import { describe, expect, it } from 'vitest';
import { parseDateRaw, parseFeedDate } from '../src/feeds/dates.js';

const iso = (d: Date | null) => d?.toISOString() ?? null;
const NOW = new Date('2026-10-23T12:00:00Z');

describe('parseFeedDate', () => {
  it.each([
    ['Tue, 21 Oct 2026 08:15:00 GMT', '2026-10-21T08:15:00.000Z'],
    ['Tue, 21 Oct 2026 08:15:00 +0200', '2026-10-21T06:15:00.000Z'],
    ['Tue, 21 Oct 2026 08:15:00 -05:00', '2026-10-21T13:15:00.000Z'],
    ['21 Oct 2026 10:00 EST', '2026-10-21T15:00:00.000Z'],
    ['Tuesday, 21 October 2026 08:15:00 UTC', '2026-10-21T08:15:00.000Z'],
    ['Tue, 21 Oct 26 08:15:00 GMT', '2026-10-21T08:15:00.000Z'],
    ['Tue, 21 Oct 2026 08:15:00 CEST', '2026-10-21T06:15:00.000Z'],
    ['Tue,21 Oct 2026 08:15:00 IST', '2026-10-21T02:45:00.000Z'],
    ['2026-10-21T08:15:00Z', '2026-10-21T08:15:00.000Z'],
    ['2026-10-21T08:15:00.123+05:30', '2026-10-21T02:45:00.000Z'],
    ['2026-10-21T08:15:00+0100', '2026-10-21T07:15:00.000Z'],
    ['2026-10-21 08:15:00', '2026-10-21T08:15:00.000Z'],
    ['2026-10-21', '2026-10-21T00:00:00.000Z'],
    ['20261021T081500Z', '2026-10-21T08:15:00.000Z'],
    ['  Tue, 21   Oct 2026 08:15:00 GMT  ', '2026-10-21T08:15:00.000Z'],
  ])('parses %s', (input, expected) => {
    expect(iso(parseFeedDate(input, NOW))).toBe(expected);
  });

  it('clamps dates more than an hour in the future to now', () => {
    expect(iso(parseFeedDate('Sat, 01 Jan 2033 00:00:00 +0000', NOW))).toBe(NOW.toISOString());
    expect(iso(parseFeedDate('2026-10-23T14:00:00Z', NOW))).toBe(NOW.toISOString());
  });
  it('accepts up to one hour of clock skew', () => {
    expect(iso(parseFeedDate('2026-10-23T12:59:00Z', NOW))).toBe('2026-10-23T12:59:00.000Z');
  });
  it('returns null for garbage, empty and implausibly old dates', () => {
    expect(parseFeedDate('yesterday-ish', NOW)).toBeNull();
    expect(parseFeedDate('', NOW)).toBeNull();
    expect(parseFeedDate(undefined, NOW)).toBeNull();
    expect(parseFeedDate('Thu, 01 Jan 1970 00:00:00 GMT', NOW)).toBeNull();
    expect(parseFeedDate('Tue, 32 Foo 2026 08:15:00 GMT', NOW)).toBeNull();
  });
  it('rejects unknown zone names rather than guessing', () => {
    expect(parseDateRaw('Tue, 21 Oct 2026 08:15:00 XYZT')).not.toEqual(new Date('2026-10-21T08:15:00Z'));
  });
});
