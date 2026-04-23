import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CSS = readFileSync(join(ROOT, 'src/index.css'), 'utf-8');
const APP = readFileSync(join(ROOT, 'src/App.jsx'), 'utf-8');
const HEADER = readFileSync(join(ROOT, 'src/components/Header.jsx'), 'utf-8');
const COMP = readFileSync(join(ROOT, 'src/components/MapFloatingIcons.jsx'), 'utf-8');

describe('MOB-FIX-B: floating map icons', () => {
  it('MapFloatingIcons component exists and is imported by App', () => {
    assert.match(APP, /from\s+['"]\.\/components\/MapFloatingIcons['"]/);
    assert.match(APP, /<MapFloatingIcons\s*\/?>/);
  });

  it('gates render to mobile OR tablet via useBreakpoint', () => {
    assert.match(COMP, /from\s+['"]\.\.\/hooks\/useBreakpoint['"]/);
    assert.match(COMP, /isMobile\s*,\s*isTablet/);
    assert.match(COMP, /!isMobile\s*&&\s*!isTablet/);
  });

  it('renders 4 icon buttons: severity, coverage, geo, intel', () => {
    assert.match(COMP, /id="severity"/);
    assert.match(COMP, /id="coverage"/);
    assert.match(COMP, /id="geo"/);
    assert.match(COMP, /id="intel"/);
  });

  it('icons have aria-labels for a11y', () => {
    assert.match(COMP, /label="Severity overlay"/);
    assert.match(COMP, /label="Coverage overlay"/);
    assert.match(COMP, /label="Geopolitical overlay"/);
    assert.match(COMP, /label="Intel"/);
  });

  it('popover has role="dialog" aria-modal="false"', () => {
    assert.match(COMP, /role="dialog"/);
    assert.match(COMP, /aria-modal="false"/);
  });

  it('intel icon navigates to /intel route', () => {
    assert.match(COMP, /navigate\(\s*['"]\/intel['"]\s*\)/);
    assert.match(COMP, /from\s+['"]react-router-dom['"]/);
  });

  it('reuses filterStore mapOverlay state (no new store)', () => {
    assert.match(COMP, /from\s+['"]\.\.\/stores\/filterStore['"]/);
    assert.match(COMP, /setMapOverlay/);
  });

  it('closes on outside pointerdown', () => {
    assert.match(COMP, /pointerdown/);
  });

  it('closes on Escape key', () => {
    assert.match(COMP, /e\.key\s*===\s*'Escape'/);
  });

  it('Header chips gated to desktop only (not mobile, not tablet)', () => {
    assert.match(HEADER, /isMap\s*&&\s*!isMobile\s*&&\s*!isTablet/);
  });

  it('CSS hides desktop .map-controls on mobile+tablet (≤1023px)', () => {
    assert.match(
      CSS,
      /@media\s*\(max-width:\s*1023px\)[\s\S]*?\.map-controls\s*\{\s*display:\s*none/,
    );
  });

  it('CSS hides .map-corner.br legend on mobile+tablet (≤1023px)', () => {
    assert.match(
      CSS,
      /@media\s*\(max-width:\s*1023px\)[\s\S]*?\.map-corner\.br\s*\{\s*display:\s*none/,
    );
  });

  it('CSS defines .map-fab-stack', () => {
    assert.match(CSS, /\.map-fab-stack\s*\{/);
  });

  it('CSS defines .map-fab with 44px touch target', () => {
    assert.match(CSS, /\.map-fab\s*\{[\s\S]*?width:\s*44px[\s\S]*?height:\s*44px/);
  });

  it('CSS defines .map-fab-popover', () => {
    assert.match(CSS, /\.map-fab-popover\s*\{/);
  });

  it('CSS shows .map-fab-stack only at ≤1023px', () => {
    assert.match(
      CSS,
      /@media\s*\(max-width:\s*1023px\)[\s\S]*?\.map-fab-stack\s*\{\s*display:\s*block/,
    );
  });

  it('removed the MOB-C bottom-strip override of .map-controls (no fixed position+bottom:56px)', () => {
    const noStrip = !/\.map-controls\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*calc\(56px/m.test(CSS);
    assert.ok(noStrip, 'bottom-strip override should be removed');
  });
});
