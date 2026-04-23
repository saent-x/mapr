import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getBreakpointFromWidth } from '../src/hooks/useBreakpoint.ts';

describe('getBreakpointFromWidth', () => {
  it('returns isMobile for widths <= 767', () => {
    const r = getBreakpointFromWidth(360);
    assert.equal(r.isMobile, true);
    assert.equal(r.isTablet, false);
    assert.equal(r.isDesktop, false);
  });

  it('returns isMobile for exactly 767', () => {
    const r = getBreakpointFromWidth(767);
    assert.equal(r.isMobile, true);
  });

  it('returns isTablet for 768..1023', () => {
    const r = getBreakpointFromWidth(800);
    assert.equal(r.isMobile, false);
    assert.equal(r.isTablet, true);
    assert.equal(r.isDesktop, false);
  });

  it('returns isTablet for exactly 1023', () => {
    const r = getBreakpointFromWidth(1023);
    assert.equal(r.isTablet, true);
  });

  it('returns isDesktop for 1024+', () => {
    const r = getBreakpointFromWidth(1024);
    assert.equal(r.isDesktop, true);
    assert.equal(r.isMobile, false);
    assert.equal(r.isTablet, false);
  });

  it('returns isDesktop fallback for 0 (SSR)', () => {
    const r = getBreakpointFromWidth(0);
    assert.equal(r.isDesktop, true);
  });
});
