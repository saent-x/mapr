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
