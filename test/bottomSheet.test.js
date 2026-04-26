import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = readFileSync(join(ROOT, 'src/components/ui/BottomSheet.tsx'), 'utf-8');
const CSS = readFileSync(join(ROOT, 'src/index.css'), 'utf-8');

describe('BottomSheet', () => {
  it('returns null when open is false', () => {
    assert.match(SRC, /if\s*\(\s*!open\s*\)\s*return\s+null/);
  });

  it('declares scrim + sheet structural elements', () => {
    assert.match(SRC, /className="bottom-sheet-scrim"/);
    assert.match(SRC, /className="bottom-sheet"/);
    assert.match(SRC, /className="bottom-sheet-handle"/);
    assert.match(SRC, /className="bottom-sheet-body"/);
  });

  it('exposes a11y dialog semantics', () => {
    assert.match(SRC, /role="dialog"/);
    assert.match(SRC, /aria-modal="true"/);
    assert.match(SRC, /aria-label=\{ariaLabel/);
  });

  it('portals to document.body via createPortal', () => {
    assert.match(SRC, /import\s*\{\s*createPortal\s*\}\s*from\s+['"]react-dom['"]/);
    assert.match(SRC, /createPortal\(/);
    assert.match(SRC, /document\.body/);
  });

  it('registers Escape key handler to close', () => {
    assert.match(SRC, /key\s*===\s*['"]Escape['"]/);
  });

  it('locks body scroll while open', () => {
    assert.match(SRC, /document\.body\.style\.overflow\s*=\s*['"]hidden['"]/);
  });

  it('implements swipe-down dismiss via pointer events', () => {
    assert.match(SRC, /onPointerDown/);
    assert.match(SRC, /onPointerMove/);
    assert.match(SRC, /onPointerUp/);
  });

  it('has CSS class rules defined in index.css', () => {
    assert.match(CSS, /\.bottom-sheet-scrim\s*\{/, 'bottom-sheet-scrim rule missing');
    assert.match(CSS, /\.bottom-sheet\s*\{/, 'bottom-sheet rule missing');
    assert.match(CSS, /\.bottom-sheet-handle\s*\{/, 'bottom-sheet-handle rule missing');
  });

  it('falls back to no-motion under prefers-reduced-motion in CSS', () => {
    assert.match(
      CSS,
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]{0,400}\.bottom-sheet/,
      'reduced-motion rule must target .bottom-sheet',
    );
  });
});
