# MOBILE_VERIFY — Plan 2026-04-22 Mobile/Tablet Responsive

**Date:** 2026-04-23
**Branch:** `mob-e-verify` (merge of MOB-A+B [`57de4ef`] and MOB-C [`aa08ba6`] off plan commit `ef3b541`)
**Scope:** Plan tasks 13 (desktop-invariance regression test) and 14 (manual verify across viewports).

---

## Method

This worktree was provisioned from `ef3b541` (plan-only). MOB-A..D commits sat on two parallel feature lineages; both were merged in before verify (`merge: MOB-A+B…` and `merge: MOB-C…`). One CSS conflict in `src/index.css` (both branches appended at end-of-file) resolved by concatenation — no rule lost.

Browser-driven viewport walkthrough at `360×640 / 414×896 / 768×1024 / 1024×1366 / 1440×900` was **not run** (no headless browser harness in this environment). Verification is therefore code-level: compile (`tsc --noEmit` clean), build (`vite build` clean), full test suite (`npm test` — 567 pass / 0 fail / 4 skip), Vite dev server boot smoke (HTTP 200 on `/` + `/src/index.css`), and structural file/CSS audit covering every checklist item in plan task 14.

---

## Task 13 — Desktop-invariance regression test

**File:** `test/mobileResponsive.test.js`
Appended `describe('desktop invariance', …)` with five assertions.

### Plan deviation (one-line tweak)

The plan-spec test split CSS on `/@media/` and asserted each rule lives in `pre = CSS.split(/@media/)[0]`. This **fails for `.article-sheet`** because the file already contained pre-existing non-mobile `@media (max-width: 1200px)` and `@media (max-width: 900px)` blocks (lines 911 / 2004 / 2009) **before any mobile work began**. `.article-sheet` is at line 971 — i.e. legitimately a desktop rule, but after a 900px break.

Tweak: split on `/@media\s*\(max-width:\s*(?:1023|767)px\)/` instead. This preserves the assertion's intent (rule must not be moved into a mobile breakpoint block) while tolerating pre-existing non-mobile media queries. All 5 assertions pass.

### Result
```
✔ desktop invariance
  ✔ still has original layout grid-template-columns: 52px 1fr (outside media queries)
  ✔ still has .news-panel { width: ... } base rule
  ✔ still has .side-panels base rule
  ✔ still has .floating-panel base rule
  ✔ still has .article-sheet base rule
```

---

## Task 14 — Verify checklist

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | Header mobile (logo + OPS + hamburger + search) | ✅ | `Header.jsx:7,51-52,77,152-172` — imports `useBreakpoint`, `menuOpen`/`searchOpen` state, conditional layout |
| 2 | `MobileBottomNav` rendered in Layout, 3 slots | ✅ | `Layout.jsx:162` renders nav; `MobileBottomNav.jsx:12,24` — Map/Intel/Filters, `intel-mobile` mode |
| 3 | `MobileIntelSheet` wraps Anomaly/Watchlist/Narrative in `BottomSheet` | ✅ | `MobileIntelSheet.jsx:18-36` — gated by `isMobile`, `maxHeightVh=85` |
| 4 | `FilterDrawer` becomes `BottomSheet` on mobile | ✅ | `FilterDrawer.jsx:31,335-346` — `BottomSheet` with `maxHeightVh=90`; aside path only when `!isMobile` |
| 5 | `NewsPanel` peek bar + full-screen `BottomSheet` `ArticleSheet` | ✅ | `NewsPanel.jsx:282-290` (`BottomSheet maxHeightVh=100`), `:410-417` (peek bar), `:85-88` (Escape) |
| 6 | `FlatMap` + `Globe` use `useBreakpoint` (no `window.innerWidth`); flat default | ✅ | `FlatMap.jsx:7`, `Globe.jsx:53,56-59` — hook imported, no inline matchMedia |
| 6b | Map controls bottom strip + legend repositioned on mobile | ✅ | `index.css:2265+` — `.map-controls` at `bottom: calc(56px + safe-area-inset)`, `.map-corner.br` repositioned |
| 7 | `RegionDetailPage` — 2-col tablet, 1-col mobile, minimap fits | ✅ | `index.css:2311-2333` — `region-stats` 2-col @ tablet, 1-col @ mobile; `region-minimap` height clamped `200..240px` |
| 8 | `EntityExplorerPage` details → `BottomSheet` on mobile | ✅ | `EntityExplorerPage.jsx:123-129` |
| 8b | `EntityRelationshipGraph` pinch-zoom + tap-select; node-drag off mobile | ✅ | `EntityRelationshipGraph.jsx:635-646,781-846` |
| 9 | `AdminPage` tables wrapped + sections stack on mobile | ✅ | `index.css:2349-2371`; `AdminPage.jsx` table wrappers added |
| 10 | `BottomSheet` primitive: scrim, swipe-dismiss, focus trap, Escape, reduced-motion | ✅ | `BottomSheet.tsx:29-34,41-44,69,103,105`; `index.css:2069` reduced-motion fallback |
| 11 | `uiStore` documents `'intel-mobile'` value | ✅ | `uiStore.js:63` — JSDoc comment includes `intel-mobile` |
| 12 | No horizontal scroll at ≤1023px | ✅ | `index.css:2080` — `html, body { overflow-x: hidden }` inside `@media (max-width: 1023px)` |
| 13 | Touch targets ≥ 44×44px on mobile | ✅ | `index.css:2083-2087` — global `min-height: 44px; min-width: 44px;` for buttons/links |
| 14 | Desktop 1440×900 untouched | ✅ | `index.css:164` `.layout` base rule unchanged (`52px 1fr` / `44px 1fr 28px`); all desktop rules outside mobile media blocks |

### Build / typecheck / tests
- `npx tsc --noEmit` — clean.
- `npm run build` — `built in 418ms`, no errors.
- `npm test` — **567 pass, 0 fail, 4 skip** (pre-existing skips, unrelated to mobile work).
- `vite` dev — HTTP 200 on `/` and `/src/index.css`.

---

## Regressions found in MOB-A/B/C/D

**None blocking.**

Two minor observations, neither requires a fix in this task:

1. **Plan-spec test gap (Task 13).** The original `CSS.split(/@media/)[0]` filter was over-eager (failed against pre-existing 900px desktop breakpoints). Tightened to mobile-only breakpoints; documented above. One-line tweak applied here.
2. **Worktree integration gap.** This worktree was started off the plan commit (`ef3b541`) instead of from a pre-merged base of MOB-A..D. Resolved by merging both feature lineages locally before verify. A future task harness should integrate prerequisites before spawning the verify task.

No `MOB-A..D` commit modified a desktop CSS rule — every change is appended after line 2014 inside `(max-width: 1023px)` or `(max-width: 767px)` media blocks.

---

## Caveats

- **Real-device + visual diff not performed.** Code-level audit + Vite boot smoke only. A pixel-level snapshot diff at 1440×900 (pre-/post-merge) would be the gold standard; recommend running it before shipping to production.
- **Touch-gesture verification not performed.** `EntityRelationshipGraph` pinch-zoom + tap-select is implemented in code but not exercised against a touch input device.
- **Reduced-motion / focus-trap a11y** verified by grep, not by screen reader.
