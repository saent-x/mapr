import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as _rf, readFileSync } from 'node:fs';
import { join as _join, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CSS = readFileSync(join(ROOT, 'src/index.css'), 'utf-8');

describe('mobile CSS foundations', () => {
  it('has media query at max-width: 1023px', () => {
    assert.match(CSS, /@media\s*\(max-width:\s*1023px\)/);
  });
  it('has media query at max-width: 767px', () => {
    assert.match(CSS, /@media\s*\(max-width:\s*767px\)/);
  });
  it('prevents horizontal scroll on body at mobile', () => {
    assert.match(
      CSS,
      /@media\s*\(max-width:\s*1023px\)[\s\S]*?(?:html|body)[\s\S]*?overflow-x:\s*hidden/,
    );
  });
  it('layout grid stacks on mobile (single column)', () => {
    assert.match(
      CSS,
      /@media\s*\(max-width:\s*767px\)[\s\S]*?\.layout\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
    );
  });
  it('hides desktop sidebar on mobile', () => {
    assert.match(
      CSS,
      /@media\s*\(max-width:\s*767px\)[\s\S]*?\.app-sidebar\s*\{[\s\S]*?display:\s*none/,
    );
  });
  it('ensures touch-target min size on mobile buttons', () => {
    assert.match(
      CSS,
      /@media\s*\(max-width:\s*1023px\)[\s\S]*?min-height:\s*44px/,
    );
  });
});

describe('FlatMap + Globe use useBreakpoint instead of inline matchMedia', () => {
  const SRC = _join(import.meta.dirname, '..', 'src');
  const flatmap = _rf(_join(SRC, 'components/FlatMap.jsx'), 'utf-8');
  const globe = _rf(_join(SRC, 'components/Globe.jsx'), 'utf-8');

  it('FlatMap imports useBreakpoint', () => {
    assert.match(flatmap, /from\s+['"]\.\.\/hooks\/useBreakpoint['"]/);
  });
  it('FlatMap no longer calls window.innerWidth', () => {
    assert.equal(/window\.innerWidth/.test(flatmap), false);
  });
  it('Globe imports useBreakpoint', () => {
    assert.match(globe, /from\s+['"]\.\.\/hooks\/useBreakpoint['"]/);
  });
  it('Globe no longer calls window.innerWidth', () => {
    assert.equal(/window\.innerWidth/.test(globe), false);
  });
});

describe('region detail mobile layout', () => {
  it('region-page collapses 2-col grid to single-column flex on mobile', () => {
    assert.match(
      CSS,
      /@media\s*\(max-width:\s*767px\)[\s\S]*?\.region-page\s*\{[\s\S]*?flex-direction:\s*column/,
    );
  });
  it('region-page allows vertical scroll and prevents horizontal scroll on mobile', () => {
    assert.match(
      CSS,
      /@media\s*\(max-width:\s*767px\)[\s\S]*?\.region-page\s*\{[\s\S]*?overflow-x:\s*hidden/,
    );
  });
  it('region-articles drops the desktop right border on mobile', () => {
    assert.match(
      CSS,
      /@media\s*\(max-width:\s*767px\)[\s\S]*?\.region-articles\s*\{[\s\S]*?border-right:\s*0/,
    );
  });
  it('region-name hero font shrinks on mobile (≤30px)', () => {
    const m = CSS.match(/@media\s*\(max-width:\s*767px\)[\s\S]*?\.region-page\s+\.region-name\s*\{[\s\S]*?font-size:\s*(\d+)px/);
    assert.ok(m, 'region-name font-size override must exist on mobile');
    assert.ok(parseInt(m[1], 10) <= 30, `region-name font-size on mobile should be ≤30px, got ${m[1]}px`);
  });
  it('region-picker-row meets 44px touch target on mobile', () => {
    assert.match(
      CSS,
      /@media\s*\(max-width:\s*767px\)[\s\S]*?\.region-picker-row\s*\{[\s\S]*?min-height:\s*44px/,
    );
  });
});

describe('desktop invariance', () => {
  it('still has original layout grid-template-columns: 52px 1fr (outside media queries)', () => {
    const pre = CSS.split(/@media\s*\(max-width:\s*(?:1023|767)px\)/)[0];
    assert.match(pre, /\.layout\s*\{[\s\S]*?grid-template-columns:\s*52px\s+1fr/);
  });
  it('still has .news-panel { width: ... } base rule', () => {
    const pre = CSS.split(/@media\s*\(max-width:\s*(?:1023|767)px\)/)[0];
    assert.match(pre, /\.news-panel\s*\{/);
  });
  it('still has .side-panels base rule', () => {
    const pre = CSS.split(/@media\s*\(max-width:\s*(?:1023|767)px\)/)[0];
    assert.match(pre, /\.side-panels\s*\{/);
  });
  it('still has .floating-panel base rule', () => {
    const pre = CSS.split(/@media\s*\(max-width:\s*(?:1023|767)px\)/)[0];
    assert.match(pre, /\.floating-panel\s*\{/);
  });
  it('still has .news-item-detail base rule', () => {
    const pre = CSS.split(/@media\s*\(max-width:\s*(?:1023|767)px\)/)[0];
    assert.match(pre, /\.news-item-detail\s*\{/);
  });
});
