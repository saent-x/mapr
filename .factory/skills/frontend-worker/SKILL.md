---
name: frontend-worker
description: Implements frontend features - React components, state management, routing, UI, visualizations
---

# Frontend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

For features involving:
- React components (src/components/)
- State management (Zustand stores)
- Routing (react-router-dom)
- Data fetching and display
- UI/UX improvements
- Visualizations (globe, map, charts, graphs)
- CSS styling (src/index.css)
- Internationalization (src/i18n/)
- Frontend hooks and services

## Required Skills

- `agent-browser` - MUST be used for manual verification of all UI features. Invoke it to navigate the app, click elements, verify visual output.

## Work Procedure

### 1. Understand the Feature
- Read the feature description, preconditions, expectedBehavior, and verificationSteps carefully
- Read `AGENTS.md` for mission boundaries and conventions
- Read `.factory/library/architecture.md` for codebase patterns
- Identify which components, stores, and routes need to change
- Check existing component patterns before creating new ones

### 2. Write Tests First (TDD)
- Create or update test files in `test/` directory
- For utility functions: unit tests with Node.js test runner
- Test file naming: `test/{featureName}.test.js`
- Run tests to confirm they fail: `node --test test/{file}.test.js`
- Note: Component rendering tests are limited without a DOM environment. Focus on testing logic (stores, utils, data transforms) and verify rendering via agent-browser.

### 3. Implement
- Follow existing React patterns (functional components, hooks)
- Use ES modules (import/export), no TypeScript
- When creating new components, follow existing naming and file structure
- For state management: create Zustand stores in `src/stores/` directory
- For routing: add routes in `src/main.jsx` or `src/App.jsx`
- For CSS: add styles to `src/index.css` following existing class naming patterns
- All user-visible strings must use i18n: `t('key')` from `useTranslation()`
- Icons from `lucide-react`

### 4. Run Tests
- Run `node --test` and confirm all tests pass
- Verify no import/syntax errors by checking the Vite dev server console

### 5. Manual Verification with agent-browser
- Ensure the dev server is running (backend on 3030, Vite on 5173)
- Use `agent-browser` to:
  - Navigate to http://localhost:5173
  - Interact with new/modified UI elements
  - Verify visual rendering, layout, responsiveness
  - Check console for errors
  - Test user flows end-to-end
- Each flow tested = one `interactiveChecks` entry with specific action and observation

### 6. Final Verification
- Run `node --test` - all tests pass
- Check Vite dev server for build/compilation errors
- Verify no console errors in the browser

## Example Handoff

```json
{
  "salientSummary": "Extracted global state from App.jsx into 3 Zustand stores (useNewsStore, useFilterStore, useUIStore). Refactored App.jsx from 968 to ~200 lines. Verified via agent-browser: globe loads, filters work, news panel displays articles, region selection works.",
  "whatWasImplemented": "Created src/stores/newsStore.js (articles, events, source health, fetch logic), src/stores/filterStore.js (all filter state: severity, category, time range, sort, search), src/stores/uiStore.js (map mode, drawer, selection, toasts). Updated App.jsx to consume stores. Updated all components to use stores directly instead of prop drilling. Added 6 test cases for store behavior.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "node --test", "exitCode": 0, "observation": "118 passing, 4 skipped" },
      { "command": "curl -sf http://localhost:5173/ | head -5", "exitCode": 0, "observation": "HTML served correctly with React root" }
    ],
    "interactiveChecks": [
      { "action": "Loaded http://localhost:5173 in agent-browser", "observed": "Globe renders with article dots, header shows stats, no console errors" },
      { "action": "Opened filter drawer and changed severity to Critical", "observed": "Article count reduced, only red dots visible on map" },
      { "action": "Clicked a country on the map", "observed": "News panel opened showing articles for that region" },
      { "action": "Typed 'earthquake' in search bar", "observed": "Articles filtered to earthquake-related stories only" },
      { "action": "Switched to flat map mode", "observed": "Leaflet map rendered with clustered markers, same articles shown" }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "test/stores.test.js",
        "cases": [
          { "name": "newsStore fetches and stores articles", "verifies": "Store loads data from backend API" },
          { "name": "filterStore applies severity filter", "verifies": "Filtered articles match severity threshold" },
          { "name": "filterStore applies search query", "verifies": "Search filters articles by title keyword" },
          { "name": "uiStore toggles map mode", "verifies": "Map mode switches between globe and flat" },
          { "name": "uiStore manages region selection", "verifies": "Selected region state updates correctly" },
          { "name": "filterStore reset clears all filters", "verifies": "All filters return to defaults" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- A backend API endpoint needed by the feature doesn't exist yet
- The backend returns unexpected data shapes that don't match what the feature needs
- Existing component imports/dependencies are broken
- The Vite dev server fails to compile
- agent-browser cannot interact with a specific UI element (e.g., WebGL canvas)
- Requirements are ambiguous about UI behavior or layout
