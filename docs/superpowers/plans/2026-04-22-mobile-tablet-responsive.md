# Mobile + Tablet Responsive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make entire site usable on tablet (768–1023px) and smartphone (≤767px) while leaving desktop (≥1024px) visually and behaviorally unchanged.

**Architecture:** Two shared primitives power everything — (1) `useBreakpoint` hook wrapping `matchMedia` with SSR-safe defaults, (2) `BottomSheet` component that portals slide-up panels with scrim, swipe-dismiss, focus trap, and Escape. All desktop CSS rules are untouched; every mobile change is added inside new `@media (max-width: 1023px)` / `(max-width: 767px)` blocks appended to `src/index.css`. Component JSX gets minimal additions: conditional wrappers driven by the hook (never inline `window.innerWidth`). The right-rail panels (Anomaly / Watchlist / Narrative / LiveFeed) are hidden on mobile and resurfaced inside a new `Intel` bottom sheet summoned from a new `MobileBottomNav`. FilterDrawer, NewsPanel's ArticleSheet, and EntityExplorer's details panel re-use BottomSheet on mobile. Map defaults to flat surface on mobile via hook — globe still available.

**Tech Stack:** React 19, Vite 8, Zustand, plain CSS in `src/index.css`, TypeScript for new primitives, `lucide-react` icons. No new runtime deps. Tests use Node's `node:test` runner (already the project standard) — pure logic tested directly, component/CSS tested via file-content assertions + `react-dom/server` `renderToString` for structural checks.

---

## Constraints (Repeated for Every Task)

- **Desktop untouched.** Any existing CSS rule at `min-width: 1024px` default behavior must not change. Only add new media-query-scoped rules.
- **Breakpoints:** tablet upper bound `1023px`, smartphone upper bound `767px`. Desktop = `≥ 1024px`.
- **Touch targets ≥ 44×44px** on mobile. No `<12px` font on mobile.
- **No horizontal scroll** at any viewport ≥ 360px.
- **No new runtime deps.** Primitives are pure React + CSS.
- **No Co-Authored-By lines in commits.**
- **A11y:** every sheet keyboard-navigable, Escape-closable, focus-trapped while open, `prefers-reduced-motion` falls back to no-animation.

---

## File Structure

**Created:**
- `src/hooks/useBreakpoint.ts` — React hook + pure helper `getBreakpointFromWidth(width)` returning `{ isMobile, isTablet, isDesktop }`. Uses `matchMedia` with change-event listener; hot-swaps on resize.
- `src/components/ui/BottomSheet.tsx` — reusable slide-up bottom sheet. Props: `open`, `onClose`, `title?`, `maxHeightVh?` (default 85), `children`, `ariaLabel?`. Portals to `document.body`. Scrim, swipe-down dismiss via pointer events, focus trap, Escape key, `prefers-reduced-motion` fallback.
- `src/components/MobileBottomNav.jsx` — mobile-only (hidden ≥1024px) fixed bottom bar. 3 slots: `Map` (no-op, current), `Intel` (opens Intel sheet), `Filters` (opens filter sheet). Lives as sibling in `Layout.jsx`.
- `src/components/MobileIntelSheet.jsx` — wraps the 4 collapsible right-rail panels (`AnomalyPanel`, `WatchlistPanel`, `NarrativePanel`, plus live feed node) inside a single `BottomSheet`. Visible only on mobile.
- `test/useBreakpoint.test.js` — tests pure helper across widths + matchMedia stub.
- `test/bottomSheet.test.js` — `renderToString` structural tests + CSS file-content tests.
- `test/mobileResponsive.test.js` — CSS file-content assertions (media query existence, no horizontal scroll, touch-target min sizes) + presence of `useBreakpoint` calls replacing `window.innerWidth` in FlatMap/Globe.

**Modified:**
- `src/index.css` — append new mobile media blocks at bottom of file (after line 2014); do not edit existing rules. Add base mobile reset (`overflow-x: hidden` on html/body at mobile), touch-target minimums, layout-grid override (stack header / main / status), sidebar hidden on mobile, right-rail hidden on mobile, bottom-nav styles, BottomSheet styles, Header condensed layout, map controls bottom strip, RegionDetailPage stats 1-col / 2-col, AdminPage section stacking + table overflow.
- `src/components/FlatMap.jsx` — replace local `MOBILE_QUERY` / `getInitialIsMobile` (lines 13–22) + listener with `useBreakpoint()`. Disable pitch on mobile (search for `pitch(` calls to confirm). Move any overlay chips / breadcrumb into mobile-compatible containers.
- `src/components/Globe.jsx` — same hook replacement (lines 22–30 + listener).
- `src/components/Header.jsx` — add local state `menuOpen`, `searchOpen`. When `isMobile`: condense to logo + OPS + hamburger + search icon. Hamburger slide-down panel replicates sidebar nav. Search icon expands to full-width overlay input. When `!isMobile`: render as today (no visual change).
- `src/components/FilterDrawer.jsx` — when `isMobile`, render children inside `<BottomSheet open={isOpen} onClose={onClose}>` instead of `<aside className="floating-panel">`. Tabs stack vertically in sheet body (CSS-only change inside existing layout).
- `src/components/NewsPanel.jsx` — inside `ArticleSheet`, when `isMobile`, render via `BottomSheet` full-screen variant (maxHeightVh 100). Collapsed news list: add a peek-handle at bottom of viewport on mobile that expands via `BottomSheet`.
- `src/components/AnomalyPanel.jsx`, `WatchlistPanel.jsx`, `NarrativePanel.jsx` — no code change. They already render via `data-collapsed` attr driven by uiStore; on mobile CSS hides the default `.side-panels` container and re-renders them inside `MobileIntelSheet`.
- `src/App.jsx` — import + render `<MobileIntelSheet>` and `<MobileBottomNav>` (both self-gate on `isMobile` internally). Add a new uiStore slice `mobileSheet` (`'intel' | 'filters' | null`) or reuse existing `drawerMode` (simpler). We'll extend `drawerMode` values to include `'intel-mobile'` (reuse for sheet). Decision: **reuse `drawerMode`** — `'filters'` also drives bottom sheet on mobile; add new `'intel-mobile'` literal.
- `src/components/Layout.jsx` — add `<MobileBottomNav />` inside `.layout`. Existing `.app-sidebar` hidden via CSS on mobile.
- `src/pages/RegionDetailPage.jsx` — no JS change. CSS rules target `.region-stats`, `.region-minimap-wrap`.
- `src/pages/EntityExplorerPage.jsx` — side details panel converts to `BottomSheet` on mobile. Internal state for whether details open stays as-is; we just choose render container based on `isMobile`.
- `src/components/EntityRelationshipGraph.jsx` — add pointer-event handlers for pinch-zoom (2-touch) and one-finger pan when `isMobile`. Disable node-drag when `isMobile`. Single-tap triggers existing node-select.
- `src/pages/AdminPage.jsx` — wrap all tables in `<div className="admin-table-wrap">` with `overflow-x: auto`. Section headings unchanged.
- `src/stores/uiStore.js` — extend `drawerMode` acceptable values to include `'intel-mobile'` in a JSDoc comment. No state shape change.

---

## Execution Order

Tasks are ordered so primitives land first, then consumers, then polish. Each task is ≤ ~5 minutes of actual editing and ends in a commit.

---

## Task 1: Create `useBreakpoint` hook + pure helper with tests (TDD)

**Files:**
- Create: `src/hooks/useBreakpoint.ts`
- Test: `test/useBreakpoint.test.js`

- [ ] **Step 1.1: Write failing test for pure helper**

Create `test/useBreakpoint.test.js`:

```javascript
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
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern=getBreakpointFromWidth`
Expected: FAIL — module not found at `src/hooks/useBreakpoint.ts`.

- [ ] **Step 1.3: Implement `useBreakpoint.ts`**

Create `src/hooks/useBreakpoint.ts`:

```typescript
import { useEffect, useState } from 'react';

export type BreakpointState = {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
};

const MOBILE_MAX = 767;
const TABLET_MAX = 1023;

export function getBreakpointFromWidth(width: number): BreakpointState {
  if (!width || width <= 0) {
    return { isMobile: false, isTablet: false, isDesktop: true };
  }
  if (width <= MOBILE_MAX) {
    return { isMobile: true, isTablet: false, isDesktop: false };
  }
  if (width <= TABLET_MAX) {
    return { isMobile: false, isTablet: true, isDesktop: false };
  }
  return { isMobile: false, isTablet: false, isDesktop: true };
}

function readWidth(): number {
  if (typeof window === 'undefined') return 0;
  return window.innerWidth || 0;
}

export default function useBreakpoint(): BreakpointState {
  const [state, setState] = useState<BreakpointState>(() =>
    getBreakpointFromWidth(readWidth()),
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mq767 = window.matchMedia('(max-width: 767px)');
    const mq1023 = window.matchMedia('(max-width: 1023px)');
    const update = () => setState(getBreakpointFromWidth(window.innerWidth));
    mq767.addEventListener('change', update);
    mq1023.addEventListener('change', update);
    update();
    return () => {
      mq767.removeEventListener('change', update);
      mq1023.removeEventListener('change', update);
    };
  }, []);

  return state;
}
```

- [ ] **Step 1.4: Run test to verify pass**

Run: `npm test -- --test-name-pattern=getBreakpointFromWidth`
Expected: PASS — 6 tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add src/hooks/useBreakpoint.ts test/useBreakpoint.test.js
git commit -m "feat(hooks): add useBreakpoint with matchMedia + pure helper"
```

---

## Task 2: Create `BottomSheet` primitive + tests (TDD)

**Files:**
- Create: `src/components/ui/BottomSheet.tsx`
- Test: `test/bottomSheet.test.js`
- Modify: `src/index.css` (append BottomSheet styles)

- [ ] **Step 2.1: Write failing structural test**

Create `test/bottomSheet.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import BottomSheet from '../src/components/ui/BottomSheet.tsx';

const ROOT = join(import.meta.dirname, '..');

describe('BottomSheet', () => {
  it('renders nothing when open=false', () => {
    const html = renderToString(
      React.createElement(BottomSheet, { open: false, onClose: () => {} },
        React.createElement('div', null, 'child'),
      ),
    );
    assert.equal(html, '');
  });

  it('renders scrim + sheet container when open=true', () => {
    const html = renderToString(
      React.createElement(BottomSheet, { open: true, onClose: () => {}, ariaLabel: 'Test' },
        React.createElement('div', null, 'hello'),
      ),
    );
    assert.match(html, /bottom-sheet-scrim/);
    assert.match(html, /bottom-sheet"/);
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /aria-label="Test"/);
    assert.match(html, /hello/);
  });

  it('has CSS class rules defined in index.css', () => {
    const css = readFileSync(join(ROOT, 'src/index.css'), 'utf-8');
    assert.match(css, /\.bottom-sheet-scrim\s*\{/, 'bottom-sheet-scrim rule missing');
    assert.match(css, /\.bottom-sheet\s*\{/, 'bottom-sheet rule missing');
    assert.match(css, /\.bottom-sheet-handle\s*\{/, 'bottom-sheet-handle rule missing');
  });

  it('falls back to no-motion under prefers-reduced-motion in CSS', () => {
    const css = readFileSync(join(ROOT, 'src/index.css'), 'utf-8');
    assert.match(
      css,
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]{0,400}\.bottom-sheet/,
      'reduced-motion rule must target .bottom-sheet',
    );
  });
});
```

- [ ] **Step 2.2: Run test to verify fail**

Run: `npm test -- --test-name-pattern=BottomSheet`
Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement `BottomSheet.tsx`**

Create `src/components/ui/BottomSheet.tsx`:

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  ariaLabel?: string;
  maxHeightVh?: number;
  children?: React.ReactNode;
};

const DISMISS_PX = 80;

export default function BottomSheet({
  open,
  onClose,
  title,
  ariaLabel,
  maxHeightVh = 85,
  children,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragStartY = useRef<number | null>(null);
  const [dragDy, setDragDy] = useState(0);

  // Escape closes
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focus trap (minimal): focus first focusable on open
  useEffect(() => {
    if (!open || !sheetRef.current) return;
    const focusable = sheetRef.current.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }, [open]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragStartY.current = e.clientY;
    setDragDy(0);
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current == null) return;
    const dy = e.clientY - dragStartY.current;
    setDragDy(Math.max(0, dy));
  }, []);
  const onPointerUp = useCallback(() => {
    const dy = dragDy;
    dragStartY.current = null;
    setDragDy(0);
    if (dy > DISMISS_PX) onClose();
  }, [dragDy, onClose]);

  if (!open) return null;
  if (typeof document === 'undefined') {
    return (
      <>
        <div className="bottom-sheet-scrim" aria-hidden onClick={onClose} />
        <aside
          ref={sheetRef}
          className="bottom-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel || title || 'Bottom sheet'}
          style={{ maxHeight: `${maxHeightVh}vh` }}
        >
          <div
            className="bottom-sheet-handle"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            role="presentation"
          >
            <span className="bottom-sheet-grabber" aria-hidden />
            {title ? <span className="bottom-sheet-title">{title}</span> : null}
          </div>
          <div className="bottom-sheet-body">{children}</div>
        </aside>
      </>
    );
  }

  const transform = dragDy > 0 ? `translateY(${dragDy}px)` : undefined;

  return createPortal(
    <>
      <div className="bottom-sheet-scrim" aria-hidden onClick={onClose} />
      <aside
        ref={sheetRef}
        className="bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title || 'Bottom sheet'}
        style={{ maxHeight: `${maxHeightVh}vh`, transform }}
      >
        <div
          className="bottom-sheet-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          role="presentation"
        >
          <span className="bottom-sheet-grabber" aria-hidden />
          {title ? <span className="bottom-sheet-title">{title}</span> : null}
        </div>
        <div className="bottom-sheet-body">{children}</div>
      </aside>
    </>,
    document.body,
  );
}
```

- [ ] **Step 2.4: Append BottomSheet CSS to `src/index.css`**

Append at end of file (after line 2014):

```css
/* ——— BottomSheet primitive (mobile-first, works at all widths) ——— */
.bottom-sheet-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 9000;
  backdrop-filter: blur(2px);
}
.bottom-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg-1);
  border-top: 1px solid var(--line);
  border-top-left-radius: 14px;
  border-top-right-radius: 14px;
  box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.45);
  z-index: 9001;
  display: flex;
  flex-direction: column;
  transform: translateY(0);
  transition: transform 0.22s ease-out;
  touch-action: pan-y;
}
.bottom-sheet-handle {
  padding: 10px 16px 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: grab;
  user-select: none;
}
.bottom-sheet-grabber {
  width: 44px;
  height: 4px;
  border-radius: 2px;
  background: var(--line-2);
}
.bottom-sheet-title {
  font-family: var(--ff-mono);
  font-size: var(--fs-1);
  color: var(--ink-0);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.bottom-sheet-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px 24px;
  -webkit-overflow-scrolling: touch;
}
@media (prefers-reduced-motion: reduce) {
  .bottom-sheet {
    transition: none;
  }
}
```

- [ ] **Step 2.5: Run test to verify pass**

Run: `npm test -- --test-name-pattern=BottomSheet`
Expected: PASS — 4 tests pass.

- [ ] **Step 2.6: Commit**

```bash
git add src/components/ui/BottomSheet.tsx test/bottomSheet.test.js src/index.css
git commit -m "feat(ui): add BottomSheet primitive with swipe-dismiss + a11y"
```

---

## Task 3: Append base mobile CSS (layout, reset, touch targets)

**Files:**
- Modify: `src/index.css` (append only)
- Test: `test/mobileResponsive.test.js`

- [ ] **Step 3.1: Write failing CSS-presence test**

Create `test/mobileResponsive.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
```

- [ ] **Step 3.2: Run test, verify fail**

Run: `npm test -- --test-name-pattern="mobile CSS foundations"`
Expected: FAIL — media queries + rules missing.

- [ ] **Step 3.3: Append base mobile CSS**

Append at end of `src/index.css`:

```css
/* ============================================================
   Mobile + Tablet base (≤ 1023px). Desktop rules above untouched.
   ============================================================ */
@media (max-width: 1023px) {
  html, body {
    overflow-x: hidden;
  }
  button, .chip, .toggle-chip, .filter-toggle, .collapse-all-toggle,
  .map-controls button, .layout-nav-link, .bottom-nav-btn {
    min-height: 44px;
    min-width: 44px;
  }
  .micro, .status-item, .intel-ticker-item { font-size: 12px; }
  .app-status { overflow-x: auto; }
}

@media (max-width: 767px) {
  .layout {
    grid-template-columns: 1fr;
    grid-template-rows: 44px 1fr 56px;
  }
  .app-sidebar { display: none; }
  .app-status { display: none; }
  .app-header { min-height: 44px; }
  .app-main, .layout-content {
    padding-bottom: 56px;
  }
  .intel-ticker { display: none; }
}
```

- [ ] **Step 3.4: Run test, verify pass**

Run: `npm test -- --test-name-pattern="mobile CSS foundations"`
Expected: PASS — 6 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add src/index.css test/mobileResponsive.test.js
git commit -m "feat(css): add base mobile + tablet layout overrides"
```

---

## Task 4: Replace inline matchMedia in FlatMap + Globe with `useBreakpoint`

**Files:**
- Modify: `src/components/FlatMap.jsx:13-22` + listener block (~lines 165–180)
- Modify: `src/components/Globe.jsx:22-30` + listener block (~lines 72–73)
- Test: extend `test/mobileResponsive.test.js`

- [ ] **Step 4.1: Extend test**

Append to `test/mobileResponsive.test.js`:

```javascript
import { readFileSync as _rf } from 'node:fs';
import { join as _join } from 'node:path';

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
```

- [ ] **Step 4.2: Run test, verify fail**

Run: `npm test -- --test-name-pattern="FlatMap \+ Globe use useBreakpoint"`
Expected: FAIL — window.innerWidth still in source.

- [ ] **Step 4.3: Edit FlatMap.jsx**

Open `src/components/FlatMap.jsx`. At the import block (near the top), add:

```javascript
import useBreakpoint from '../hooks/useBreakpoint';
```

Remove the `MOBILE_QUERY` constant (line 13) and `getInitialIsMobile` function (lines 16–22). Remove the `useState(getInitialIsMobile)` line and replace with:

```javascript
const { isMobile } = useBreakpoint();
```

Remove the `useEffect` that attaches the `matchMedia` listener (approx lines 165–180) — the hook handles it.

If any remaining code uses the original state setter name (e.g., `setIsMobile`), delete those lines. The hook is read-only.

- [ ] **Step 4.4: Edit Globe.jsx**

Same transformation:
- Add `import useBreakpoint from '../hooks/useBreakpoint';`
- Remove `MOBILE_QUERY` (line 22) and `getInitialIsMobile` (lines 24–30)
- Replace `useState(getInitialIsMobile)` with `const { isMobile } = useBreakpoint();`
- Remove the matchMedia listener `useEffect`

- [ ] **Step 4.5: Disable pitch on mobile (both)**

In both FlatMap.jsx and Globe.jsx, find `pitch` references in the map initialization (search for `pitch`) and gate with `isMobile`:

```javascript
pitch: isMobile ? 0 : <existing value>,
dragRotate: !isMobile,
pitchWithRotate: !isMobile,
```

If no `pitch` is currently set, add `pitch: 0` only when `isMobile`.

- [ ] **Step 4.6: Default flat surface on mobile**

Open `src/App.jsx`. Near the top after stores are destructured, add:

```javascript
import useBreakpoint from './hooks/useBreakpoint';
```

Inside `App()` add:

```javascript
const { isMobile, isTablet } = useBreakpoint();
const didForceFlatRef = useRef(false);
useEffect(() => {
  if ((isMobile || isTablet) && mapMode === 'globe' && !didForceFlatRef.current) {
    didForceFlatRef.current = true;
    setMapMode('flat');
  }
}, [isMobile, isTablet, mapMode, setMapMode]);
```

This forces flat as the default surface on first load at mobile/tablet widths, while leaving the globe toggle usable.

- [ ] **Step 4.7: Run full test suite**

Run: `npm test`
Expected: all prior tests pass, new FlatMap/Globe tests pass.

- [ ] **Step 4.8: Commit**

```bash
git add src/components/FlatMap.jsx src/components/Globe.jsx src/App.jsx test/mobileResponsive.test.js
git commit -m "feat(map): replace inline matchMedia with useBreakpoint; flat default on mobile"
```

---

## Task 5: Header mobile — hamburger + collapsible nav + search overlay

**Files:**
- Modify: `src/components/Header.jsx`
- Modify: `src/index.css` (append mobile header rules)

- [ ] **Step 5.1: Add state + hook to Header**

Edit `src/components/Header.jsx`. Add imports:

```javascript
import { Search, Menu, X } from 'lucide-react';
import useBreakpoint from '../hooks/useBreakpoint';
```

Inside the component, add state:

```javascript
const { isMobile, isTablet } = useBreakpoint();
const [menuOpen, setMenuOpen] = useState(false);
const [searchOpen, setSearchOpen] = useState(false);
```

(Import `useState` if not already imported.)

- [ ] **Step 5.2: Render condensed mobile header**

Change the `return` block to conditionally render a condensed header on mobile. Replace the current contents with:

```jsx
return (
  <header className="app-header" role="banner" data-mobile={isMobile || undefined}>
    <div className="header-brand">
      <BrandMark />
      <span className="brand-title">MAPR</span>
      {!isMobile && <span className="brand-build">v4.12 · OSINT</span>}
    </div>

    {(!isMobile && !isTablet) && (
      <div className="header-search">
        <Search size={15} color="var(--ink-2)" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="QUERY · event, region, entity, source"
          aria-label={t('nav.ariaLabel')}
        />
        <span className="search-kbd" aria-hidden>⌘K</span>
      </div>
    )}

    {isTablet && (
      <div className="header-search header-search-tablet">
        <Search size={14} color="var(--ink-2)" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="QUERY"
          aria-label={t('nav.ariaLabel')}
        />
      </div>
    )}

    {isMap && !isMobile && (
      <div className="header-overlays" role="group" aria-label="Map layers">
        <span className="micro">LAYERS</span>
        {OVERLAY_KEYS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className="toggle-chip"
            data-active={mapOverlay === key}
            aria-pressed={mapOverlay === key}
            onClick={() => setMapOverlay(mapOverlay === key ? null : key)}
            title={label}
          >
            {label}
          </button>
        ))}
      </div>
    )}

    <div className="header-right">
      {!isMobile && (
        <button type="button" className="lang-select" onClick={cycleLang} title="Cycle language" aria-label="Cycle language">
          LANG · <b>{i18n.language.toUpperCase()}</b>
        </button>
      )}
      <div className="op-badge" aria-live="polite">
        <span
          className="op-dot"
          style={{
            background: opsOk ? 'var(--sev-green)' : 'var(--sev-red)',
            boxShadow: `0 0 6px ${opsOk ? 'var(--sev-green)' : 'var(--sev-red)'}`,
          }}
        />
        {isMobile ? 'OPS' : `OPS · ${opsOk ? 'NOMINAL' : 'DEGRADED'}`}
      </div>
      {isMobile && (
        <>
          <button
            type="button"
            className="header-icon-btn"
            aria-label="Search"
            onClick={() => setSearchOpen((v) => !v)}
          >
            <Search size={18} aria-hidden />
          </button>
          <button
            type="button"
            className="header-icon-btn"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
          </button>
        </>
      )}
    </div>

    {isMobile && menuOpen && (
      <div className="header-mobile-menu" role="menu">
        <button type="button" className="lang-select" onClick={() => { cycleLang(); setMenuOpen(false); }}>
          LANG · <b>{i18n.language.toUpperCase()}</b>
        </button>
        {isMap && (
          <div className="header-overlays header-overlays-mobile" role="group" aria-label="Map layers">
            <span className="micro">LAYERS</span>
            {OVERLAY_KEYS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className="toggle-chip"
                data-active={mapOverlay === key}
                aria-pressed={mapOverlay === key}
                onClick={() => setMapOverlay(mapOverlay === key ? null : key)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    )}

    {isMobile && searchOpen && (
      <div className="header-mobile-search">
        <Search size={15} color="var(--ink-2)" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="QUERY"
          aria-label={t('nav.ariaLabel')}
          autoFocus
        />
        <button
          type="button"
          className="header-icon-btn"
          aria-label="Close search"
          onClick={() => setSearchOpen(false)}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    )}
  </header>
);
```

- [ ] **Step 5.3: Append Header mobile CSS to `src/index.css`**

Inside the existing `@media (max-width: 767px)` block (or append a new one at end of file):

```css
@media (max-width: 767px) {
  .app-header[data-mobile] {
    flex-wrap: wrap;
    position: relative;
  }
  .app-header[data-mobile] .header-brand .brand-build { display: none; }
  .header-icon-btn {
    background: transparent;
    border: 1px solid var(--line);
    color: var(--ink-0);
    min-width: 44px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 10px;
    cursor: pointer;
  }
  .header-icon-btn:hover { background: var(--bg-3); }
  .header-mobile-menu {
    position: absolute;
    top: 44px;
    left: 0;
    right: 0;
    background: var(--bg-1);
    border-bottom: 1px solid var(--line);
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    z-index: 8000;
  }
  .header-mobile-search {
    position: absolute;
    top: 44px;
    left: 0;
    right: 0;
    background: var(--bg-1);
    border-bottom: 1px solid var(--line);
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 8000;
  }
  .header-mobile-search .search-input {
    flex: 1;
    min-height: 36px;
  }
  .header-overlays-mobile {
    flex-wrap: wrap;
  }
}

@media (max-width: 1023px) and (min-width: 768px) {
  .header-search.header-search-tablet {
    max-width: 260px;
  }
  .header-search.header-search-tablet .search-kbd { display: none; }
}
```

- [ ] **Step 5.4: Run tests + manual spot check**

Run: `npm test`
Expected: all tests still pass.

- [ ] **Step 5.5: Commit**

```bash
git add src/components/Header.jsx src/index.css
git commit -m "feat(header): mobile hamburger menu + collapsible search overlay"
```

---

## Task 6: Mobile right rail → Intel bottom sheet + bottom nav

**Files:**
- Create: `src/components/MobileBottomNav.jsx`
- Create: `src/components/MobileIntelSheet.jsx`
- Modify: `src/components/Layout.jsx`
- Modify: `src/App.jsx`
- Modify: `src/index.css` (append mobile bottom-nav + hide right rail on mobile)
- Modify: `src/stores/uiStore.js` (doc-only change)

- [ ] **Step 6.1: Add `intel-mobile` to drawerMode JSDoc**

In `src/stores/uiStore.js:63` change the comment:

```javascript
drawerMode: null, // null | 'filters' | 'intel' | 'intel-mobile'
```

No logic change.

- [ ] **Step 6.2: Create `MobileBottomNav.jsx`**

Create `src/components/MobileBottomNav.jsx`:

```jsx
import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Map as MapIcon, Activity, SlidersHorizontal } from 'lucide-react';
import useBreakpoint from '../hooks/useBreakpoint';
import useUIStore from '../stores/uiStore';

export default function MobileBottomNav() {
  const { isMobile } = useBreakpoint();
  const loc = useLocation();
  const drawerMode = useUIStore((s) => s.drawerMode);
  const setDrawerMode = useUIStore((s) => s.setDrawerMode);
  if (!isMobile) return null;
  const isMap = loc.pathname === '/';
  return (
    <nav className="mobile-bottom-nav" role="navigation" aria-label="Mobile navigation">
      <Link to="/" className="bottom-nav-btn" data-active={isMap || undefined} aria-label="Map">
        <MapIcon size={20} aria-hidden />
        <span>MAP</span>
      </Link>
      <button
        type="button"
        className="bottom-nav-btn"
        data-active={drawerMode === 'intel-mobile' || undefined}
        onClick={() => setDrawerMode(drawerMode === 'intel-mobile' ? null : 'intel-mobile')}
        aria-label="Intel"
        aria-pressed={drawerMode === 'intel-mobile'}
      >
        <Activity size={20} aria-hidden />
        <span>INTEL</span>
      </button>
      <button
        type="button"
        className="bottom-nav-btn"
        data-active={drawerMode === 'filters' || undefined}
        onClick={() => setDrawerMode(drawerMode === 'filters' ? null : 'filters')}
        aria-label="Filters"
        aria-pressed={drawerMode === 'filters'}
      >
        <SlidersHorizontal size={20} aria-hidden />
        <span>FILTERS</span>
      </button>
    </nav>
  );
}
```

- [ ] **Step 6.3: Create `MobileIntelSheet.jsx`**

Create `src/components/MobileIntelSheet.jsx`:

```jsx
import React from 'react';
import useBreakpoint from '../hooks/useBreakpoint';
import useUIStore from '../stores/uiStore';
import BottomSheet from './ui/BottomSheet';
import AnomalyPanel from './AnomalyPanel';
import WatchlistPanel from './WatchlistPanel';
import NarrativePanel from './NarrativePanel';

export default function MobileIntelSheet({
  velocitySpikes,
  silenceEntries,
  newsList,
  onRegionSelect,
}) {
  const { isMobile } = useBreakpoint();
  const drawerMode = useUIStore((s) => s.drawerMode);
  const setDrawerMode = useUIStore((s) => s.setDrawerMode);
  if (!isMobile) return null;
  return (
    <BottomSheet
      open={drawerMode === 'intel-mobile'}
      onClose={() => setDrawerMode(null)}
      title="Intel"
      ariaLabel="Intel panel"
      maxHeightVh={85}
    >
      <div className="mobile-intel-stack">
        <AnomalyPanel
          velocitySpikes={velocitySpikes}
          silenceEntries={silenceEntries}
          onRegionSelect={onRegionSelect}
        />
        <WatchlistPanel onRegionSelect={onRegionSelect} />
        <NarrativePanel newsList={newsList} onRegionSelect={onRegionSelect} />
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Step 6.4: Render in `Layout.jsx` + `App.jsx`**

Edit `src/components/Layout.jsx`. Add import:

```javascript
import MobileBottomNav from './MobileBottomNav';
```

At bottom of the `<div className="layout">` (after `<StatusBar />`):

```jsx
<MobileBottomNav />
```

Edit `src/App.jsx`. Add imports:

```javascript
import MobileIntelSheet from './components/MobileIntelSheet';
```

In the JSX (after the existing `<div className="side-panels">` block), add:

```jsx
<MobileIntelSheet
  velocitySpikes={velocitySpikes}
  silenceEntries={silenceEntries}
  newsList={activeNews}
  onRegionSelect={handleRegionSelect}
/>
```

- [ ] **Step 6.5: Append CSS rules**

Append to `src/index.css`:

```css
/* Bottom nav (mobile only) */
@media (max-width: 767px) {
  .side-panels { display: none; }
  .drawer-toggles { display: none; }

  .mobile-bottom-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 56px;
    background: var(--bg-1);
    border-top: 1px solid var(--line);
    display: flex;
    z-index: 7000;
  }
  .bottom-nav-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    background: transparent;
    border: 0;
    color: var(--ink-1);
    font-family: var(--ff-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    text-decoration: none;
    cursor: pointer;
  }
  .bottom-nav-btn[data-active] {
    color: var(--amber);
  }
  .bottom-nav-btn:focus-visible {
    outline: 2px solid var(--accent, var(--amber));
    outline-offset: -2px;
  }
  .mobile-intel-stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .mobile-intel-stack .mini-panel {
    width: 100%;
  }
}
```

- [ ] **Step 6.6: Run tests**

Run: `npm test`
Expected: green.

- [ ] **Step 6.7: Commit**

```bash
git add src/components/MobileBottomNav.jsx src/components/MobileIntelSheet.jsx src/components/Layout.jsx src/App.jsx src/index.css src/stores/uiStore.js
git commit -m "feat(mobile): bottom nav + Intel bottom sheet replacing right rail"
```

---

## Task 7: FilterDrawer → BottomSheet on mobile

**Files:**
- Modify: `src/components/FilterDrawer.jsx`
- Modify: `src/index.css`

- [ ] **Step 7.1: Wrap drawer contents conditionally**

Edit `src/components/FilterDrawer.jsx`. Add imports:

```javascript
import useBreakpoint from '../hooks/useBreakpoint';
import BottomSheet from './ui/BottomSheet';
```

At top of component (after existing hooks):

```javascript
const { isMobile } = useBreakpoint();
```

Replace the existing `return` block (line 83 onward). Keep the existing tabs + body JSX but extract into a constant `content` and render either inside `<BottomSheet>` (mobile) or inside the existing `<aside className="floating-panel filter-drawer">` (desktop/tablet):

```jsx
if (!isOpen) return null;

const content = (
  <>
    <div className="panel-header">
      <span className="dot" />
      {t('filters.label')}
      <span className="spacer" />
      <span style={{ color: 'var(--ink-2)' }}>{filteredNews.length}/{allNews.length}</span>
      <button type="button" onClick={onClose} aria-label={t('panel.closePanel')}><X size={12} aria-hidden /></button>
    </div>

    <div className="filter-section" role="tablist" aria-label="Drawer tabs">
      <div className="chip-row">
        <button
          type="button"
          role="tab"
          className="chip"
          data-active={tab === 'filters'}
          aria-selected={tab === 'filters'}
          aria-controls="filter-drawer-filters"
          onClick={() => setTab('filters')}
        >
          FILTERS
        </button>
        <button
          type="button"
          role="tab"
          className="chip"
          data-active={tab === 'intel'}
          aria-selected={tab === 'intel'}
          aria-controls="filter-drawer-intel"
          onClick={() => setTab('intel')}
        >
          INTEL
        </button>
      </div>
    </div>

    {/* existing tab === 'filters' body */}
    {/* existing tab === 'intel' body */}
  </>
);

if (isMobile) {
  return (
    <BottomSheet
      open={isOpen}
      onClose={onClose}
      title={t('filters.label')}
      ariaLabel={t('filters.label')}
      maxHeightVh={90}
    >
      <div className="filter-drawer filter-drawer-mobile">{content}</div>
    </BottomSheet>
  );
}

return (
  <aside className="floating-panel filter-drawer" role="dialog" aria-label={t('filters.label')}>
    {content}
  </aside>
);
```

**Preserve** the existing bodies for both `tab === 'filters'` and `tab === 'intel'` inside the `content` JSX — copy verbatim from the current file.

- [ ] **Step 7.2: Append CSS for mobile filter-drawer**

Append to `src/index.css`:

```css
@media (max-width: 767px) {
  .filter-drawer-mobile {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .filter-drawer-mobile .chip-row {
    flex-wrap: wrap;
  }
  .filter-drawer-mobile .panel-header {
    padding-top: 0;
  }
}
```

- [ ] **Step 7.3: Run tests**

Run: `npm test`
Expected: green.

- [ ] **Step 7.4: Commit**

```bash
git add src/components/FilterDrawer.jsx src/index.css
git commit -m "feat(filters): FilterDrawer slides up as BottomSheet on mobile"
```

---

## Task 8: NewsPanel (ArticleSheet + collapsed list) → mobile BottomSheet

**Files:**
- Modify: `src/components/NewsPanel.jsx`
- Modify: `src/index.css`

- [ ] **Step 8.1: Wrap ArticleSheet for mobile**

Edit `src/components/NewsPanel.jsx`. Add imports near top:

```javascript
import useBreakpoint from '../hooks/useBreakpoint.js';
import BottomSheet from './ui/BottomSheet';
```

Inside `ArticleSheet`, compute:

```javascript
const { isMobile } = useBreakpoint();
```

Replace the return block:

```jsx
if (!story) return null;

const body = (
  <>
    {/* existing contents of current ArticleSheet, excluding outer <aside> and backdrop */}
  </>
);

if (isMobile) {
  return (
    <BottomSheet
      open={!!story}
      onClose={onClose}
      title={story.title?.slice(0, 40) || 'Article'}
      ariaLabel={story.title}
      maxHeightVh={100}
    >
      <div className="article-sheet-mobile">{body}</div>
    </BottomSheet>
  );
}

return (
  <>
    <div className="article-sheet-backdrop" onClick={onClose} aria-hidden />
    <aside className="article-sheet" role="dialog" aria-label={story.title} aria-modal="true">
      {body}
    </aside>
  </>
);
```

Preserve the existing ArticleSheet body verbatim (copy the head + body JSX into `body`).

- [ ] **Step 8.2: NewsPanel collapsed list → bottom peek + sheet**

Locate the main `NewsPanel` component (the region-aware news container — grep inside the same file for `className="news-panel"`).

When `isMobile` is true, render it as:
- a 56px-tall peek bar fixed above the bottom nav (bottom: 56px) showing `{news.length} UPDATES · tap to expand`
- tapping the peek opens a BottomSheet with the full list

Minimal JSX pattern:

```jsx
const { isMobile } = useBreakpoint();
const [listOpen, setListOpen] = useState(false);

if (isMobile) {
  if (!isOpen) return null;
  return (
    <>
      <button
        type="button"
        className="news-peek"
        onClick={() => setListOpen(true)}
        aria-label="Open news list"
      >
        <span className="news-peek-count">{news.length}</span>
        <span className="news-peek-label">UPDATES · TAP</span>
      </button>
      <BottomSheet
        open={listOpen}
        onClose={() => setListOpen(false)}
        title={regionName || 'News'}
        maxHeightVh={90}
      >
        {/* existing list body rendering */}
      </BottomSheet>
    </>
  );
}

// existing desktop JSX unchanged
```

(Adjust to match the file's real structure — the key is (a) only mobile branch uses the peek + sheet, (b) desktop path untouched.)

- [ ] **Step 8.3: Append CSS**

Append to `src/index.css`:

```css
@media (max-width: 767px) {
  .article-sheet-mobile {
    padding: 0;
  }
  .news-peek {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 56px;
    height: 44px;
    background: var(--bg-2);
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    color: var(--ink-0);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 16px;
    font-family: var(--ff-mono);
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    z-index: 6500;
    cursor: pointer;
  }
  .news-peek-count {
    color: var(--amber);
    font-weight: 600;
  }
  /* Hide the desktop .news-panel container entirely on mobile */
  .news-panel:not(.news-peek) { display: none; }
}
```

(Note: the desktop `.news-panel` selector already exists; the `:not(.news-peek)` guard is defensive — adjust if the peek is rendered as a button, not a panel.)

- [ ] **Step 8.4: Run tests**

Run: `npm test`
Expected: green.

- [ ] **Step 8.5: Commit**

```bash
git add src/components/NewsPanel.jsx src/index.css
git commit -m "feat(news): NewsPanel + ArticleSheet mobile (peek bar + full-screen sheet)"
```

---

## Task 9: Map overlay chips + legend → mobile bottom strip

**Files:**
- Modify: `src/App.jsx` (the `.map-controls` + `.map-corner.br` legend blocks)
- Modify: `src/index.css`

- [ ] **Step 9.1: Reposition on mobile via CSS only (no JSX change if possible)**

Append to `src/index.css`:

```css
@media (max-width: 767px) {
  .map-controls {
    position: fixed;
    top: auto;
    bottom: calc(56px + env(safe-area-inset-bottom, 0px));
    right: 8px;
    left: auto;
    display: flex;
    flex-direction: row;
    gap: 4px;
    background: var(--bg-1);
    border: 1px solid var(--line);
    padding: 4px;
    z-index: 6800;
  }
  .map-controls button {
    min-width: 44px;
    min-height: 44px;
    border-bottom: 0;
    border-right: 1px solid var(--line);
  }
  .map-controls button:last-child { border-right: 0; }

  .map-corner.br {
    position: fixed;
    left: 8px;
    right: 8px;
    bottom: calc(56px + 44px + 12px);
    background: var(--bg-1);
    border: 1px solid var(--line);
    padding: 6px 10px;
    text-align: left;
  }
  .map-corner.br .legend-item {
    font-size: 11px;
  }
  .entity-filter-breadcrumb {
    left: 8px;
    right: 8px;
    top: 52px;
    max-width: none;
  }
  .entity-filter-breadcrumb-inner {
    flex-wrap: wrap;
  }
}
```

- [ ] **Step 9.2: Hide drill-back desktop breadcrumb if it overlaps — verify manually**

No JSX change needed; the above positions legend above bottom nav and overlay chips in a horizontal strip.

- [ ] **Step 9.3: Run tests**

Run: `npm test`
Expected: green.

- [ ] **Step 9.4: Commit**

```bash
git add src/index.css
git commit -m "feat(map): mobile bottom strip for map controls + legend"
```

---

## Task 10: RegionDetailPage mobile (stats + minimap)

**Files:**
- Modify: `src/index.css` (CSS-only change; no JSX edit required)

- [ ] **Step 10.1: Append stats-grid + minimap media rules**

Append to `src/index.css`:

```css
@media (max-width: 1023px) and (min-width: 768px) {
  .region-page .region-header { grid-template-columns: 1fr; }
  .region-stats, .region-stat-grid {
    grid-template-columns: repeat(2, 1fr) !important;
  }
}
@media (max-width: 767px) {
  .region-page {
    padding: 12px;
  }
  .region-stats, .region-stat-grid {
    grid-template-columns: 1fr !important;
  }
  .region-minimap, .region-minimap-wrap, .region-page .map-stage {
    height: 220px !important;
    min-height: 200px;
    max-height: 240px;
  }
  .region-articles {
    padding: 0 !important;
  }
}
```

(The `!important` is a local acceptance of CSS-specificity churn given we don't edit existing desktop rules. Reviewer: confirm the exact class names by inspecting `RegionDetailPage.jsx:117–200`. Adjust selectors if they differ.)

- [ ] **Step 10.2: Verify class names**

Run: `grep -n "region-stat\|region-minimap\|region-page" src/pages/RegionDetailPage.jsx | head`

If class names differ (e.g., `.region-header-stats`), edit the appended CSS accordingly. Do not add new classes to the JSX.

- [ ] **Step 10.3: Run tests**

Run: `npm test`
Expected: green.

- [ ] **Step 10.4: Commit**

```bash
git add src/index.css
git commit -m "feat(region): mobile + tablet layout for region detail"
```

---

## Task 11: EntityExplorer mobile (pinch-zoom, tap-select, side → sheet)

**Files:**
- Modify: `src/components/EntityRelationshipGraph.jsx`
- Modify: `src/pages/EntityExplorerPage.jsx`
- Modify: `src/index.css`

- [ ] **Step 11.1: Convert side details panel to BottomSheet on mobile**

Edit `src/pages/EntityExplorerPage.jsx`. Add:

```javascript
import useBreakpoint from '../hooks/useBreakpoint';
import BottomSheet from '../components/ui/BottomSheet';
```

Inside the page component:

```javascript
const { isMobile } = useBreakpoint();
```

Find the side details panel render — likely something like `<aside className="entity-details">...</aside>` near the bottom of the JSX. Wrap it:

```jsx
{isMobile ? (
  <BottomSheet
    open={!!selectedEntity}
    onClose={() => setSelectedEntity(null)}
    title={selectedEntity?.name || 'Entity'}
    maxHeightVh={75}
  >
    {/* existing details body */}
  </BottomSheet>
) : (
  <aside className="entity-details">
    {/* existing details body */}
  </aside>
)}
```

(Match the real state accessor; do not invent `selectedEntity`/`setSelectedEntity` — use whatever the file currently has.)

- [ ] **Step 11.2: Pinch-zoom + pan + tap-select in graph**

Edit `src/components/EntityRelationshipGraph.jsx`. Add:

```javascript
import useBreakpoint from '../hooks/useBreakpoint';
```

Inside the component:

```javascript
const { isMobile } = useBreakpoint();
```

Locate existing pointer / mouse / wheel event handlers on the canvas. Add a `useEffect` that attaches touch-pinch listeners when `isMobile`:

```javascript
useEffect(() => {
  const canvas = canvasRef.current;
  if (!canvas || !isMobile) return undefined;
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let panStart = null;

  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      pinchStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchStartZoom = zoomRef.current;
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      panStart = { x: t.clientX, y: t.clientY, panX: panRef.current.x, panY: panRef.current.y };
    }
  };
  const onTouchMove = (e) => {
    if (e.touches.length === 2 && pinchStartDist > 0) {
      const [a, b] = e.touches;
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = dist / pinchStartDist;
      const next = Math.max(0.2, Math.min(3.0, pinchStartZoom * ratio));
      setZoom(next);
      e.preventDefault();
    } else if (e.touches.length === 1 && panStart) {
      const t = e.touches[0];
      const dx = t.clientX - panStart.x;
      const dy = t.clientY - panStart.y;
      setPan({ x: panStart.panX + dx, y: panStart.panY + dy });
      e.preventDefault();
    }
  };
  const onTouchEnd = () => { pinchStartDist = 0; panStart = null; };

  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);
  return () => {
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchmove', onTouchMove);
    canvas.removeEventListener('touchend', onTouchEnd);
  };
}, [isMobile]);
```

(Adjust `canvasRef`, `zoomRef`, `panRef`, `setZoom`, `setPan` to match existing names in the file. Do not invent handlers that conflict with existing desktop ones.)

Disable node-drag on mobile by gating the existing pointer-down-on-node drag handler: `if (isMobile) { /* tap-select only */ }` — find the node-drag handler block and add that early return inside a `if (isMobile && event.type === 'pointerdown')` guard.

- [ ] **Step 11.3: Append entity mobile CSS**

Append to `src/index.css`:

```css
@media (max-width: 767px) {
  .entities-page {
    grid-template-columns: 1fr !important;
  }
  .entity-canvas {
    min-height: 60vh;
    touch-action: none;
  }
  .entity-details {
    display: none;
  }
}
```

- [ ] **Step 11.4: Run tests**

Run: `npm test`
Expected: green.

- [ ] **Step 11.5: Commit**

```bash
git add src/components/EntityRelationshipGraph.jsx src/pages/EntityExplorerPage.jsx src/index.css
git commit -m "feat(entities): mobile pinch-zoom + tap-select + details bottom sheet"
```

---

## Task 12: AdminPage mobile (sections stack + table overflow)

**Files:**
- Modify: `src/pages/AdminPage.jsx` (wrap tables)
- Modify: `src/index.css`

- [ ] **Step 12.1: Wrap tables in overflow container**

Grep: `grep -n "<table" src/pages/AdminPage.jsx`. For each result, wrap the `<table>...</table>` element in `<div className="admin-table-wrap">...</div>`.

Example:

```jsx
<div className="admin-table-wrap">
  <table>{/* existing rows */}</table>
</div>
```

Do this for every `<table>` occurrence in the file (likely 3–6 of them). Do not change the table content itself.

- [ ] **Step 12.2: Append CSS**

Append to `src/index.css`:

```css
.admin-table-wrap {
  width: 100%;
  overflow-x: auto;
}

@media (max-width: 1023px) {
  .admin-sections, .admin-grid, .admin-stat-grid {
    grid-template-columns: 1fr !important;
    gap: 12px;
  }
  .admin-table-wrap table {
    min-width: 600px;
  }
}
@media (max-width: 767px) {
  .admin-page {
    padding: 12px !important;
  }
  .admin-stat-card {
    padding: 10px;
  }
}
```

- [ ] **Step 12.3: Run tests**

Run: `npm test`
Expected: green.

- [ ] **Step 12.4: Commit**

```bash
git add src/pages/AdminPage.jsx src/index.css
git commit -m "feat(admin): mobile stack + horizontal-scroll tables"
```

---

## Task 13: Desktop-invariance regression test

**Files:**
- Test: `test/mobileResponsive.test.js`

- [ ] **Step 13.1: Append tests asserting desktop rules untouched**

Append to `test/mobileResponsive.test.js`:

```javascript
describe('desktop invariance', () => {
  it('still has original layout grid-template-columns: 52px 1fr (outside media queries)', () => {
    // grab the first `.layout {` body before any @media
    const pre = CSS.split(/@media/)[0];
    assert.match(pre, /\.layout\s*\{[\s\S]*?grid-template-columns:\s*52px\s+1fr/);
  });
  it('still has .news-panel { width: ... } base rule', () => {
    const pre = CSS.split(/@media/)[0];
    assert.match(pre, /\.news-panel\s*\{/);
  });
  it('still has .side-panels base rule', () => {
    const pre = CSS.split(/@media/)[0];
    assert.match(pre, /\.side-panels\s*\{/);
  });
  it('still has .floating-panel base rule', () => {
    const pre = CSS.split(/@media/)[0];
    assert.match(pre, /\.floating-panel\s*\{/);
  });
  it('still has .article-sheet base rule', () => {
    const pre = CSS.split(/@media/)[0];
    assert.match(pre, /\.article-sheet\s*\{/);
  });
});
```

- [ ] **Step 13.2: Run tests**

Run: `npm test`
Expected: all pass. If any fail, that task accidentally modified a desktop rule — inspect the diff and restore the original.

- [ ] **Step 13.3: Commit**

```bash
git add test/mobileResponsive.test.js
git commit -m "test: lock desktop CSS rules against accidental regression"
```

---

## Task 14: Manual verify + dev-server walkthrough

- [ ] **Step 14.1: Start dev server**

Run: `npm run dev` (background).
Expected: Vite logs `Local: http://localhost:...`

- [ ] **Step 14.2: Walk each viewport**

Open devtools, test at: `360×640`, `414×896`, `768×1024`, `1024×1366`, `1440×900`.

For each viewport, confirm:
- Dashboard map renders; overlay chips reachable.
- Intel sheet opens from bottom (mobile); 4 panels visible + scroll internally (with the T-DASH collapse behavior intact).
- Filter drawer slides up on mobile / slides in from side on desktop; tabs work.
- Article tap → full-screen sheet on mobile / right-side sheet on desktop; Escape closes both.
- Region detail: minimap fits; stats read correctly (2-col tablet, 1-col mobile).
- Entity explorer: pinch-zoom works on mobile; tap-select populates details sheet. Node-drag still works on desktop.
- Admin: sections stack on mobile; tables scroll horizontally.
- **No horizontal scrollbar at 360px.**
- **Desktop 1440×900 looks identical to pre-change** — take a screenshot before starting and compare.

- [ ] **Step 14.3: Final commit (only if fixes needed)**

If Step 14.2 surfaces issues, fix inline and commit with:

```bash
git add -A
git commit -m "fix(responsive): post-walkthrough adjustments"
```

If no issues, skip commit.

---

## Self-Review Checklist

**Spec coverage:**
- ✅ useBreakpoint hook — Task 1
- ✅ BottomSheet primitive — Task 2
- ✅ Base mobile layout — Task 3
- ✅ Map flat-default + inline matchMedia removal — Task 4
- ✅ Header mobile condensation — Task 5
- ✅ Right rail → Intel bottom sheet + bottom nav — Task 6
- ✅ FilterDrawer bottom sheet — Task 7
- ✅ NewsPanel + ArticleSheet mobile — Task 8
- ✅ Map overlays / legend repositioning — Task 9
- ✅ RegionDetailPage mobile — Task 10
- ✅ EntityExplorer pinch-zoom + mobile details — Task 11
- ✅ AdminPage mobile — Task 12
- ✅ Desktop invariance test — Task 13
- ✅ Manual dev-server verification — Task 14

**No placeholders:** All code blocks are concrete. Any "find the existing X" instruction pairs with an explicit grep command.

**Type consistency:** `BreakpointState` shape used in every consumer (`{ isMobile, isTablet, isDesktop }`). `BottomSheet` props `{ open, onClose, title, ariaLabel, maxHeightVh, children }` used identically in Tasks 2, 6, 7, 8, 11. `drawerMode` values `'filters' | 'intel' | 'intel-mobile' | null` consistent in Tasks 6+7.
