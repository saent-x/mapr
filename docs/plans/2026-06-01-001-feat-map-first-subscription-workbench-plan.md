---
title: "feat: Map-first subscription intelligence workbench"
type: feat
status: completed
date: 2026-06-01
---

# feat: Map-first subscription intelligence workbench

## Overview

MAPR should not compete with ChatGPT as a generic geopolitical chat surface. The product should become a live OSINT watchdesk: a map-first intelligence workbench that continuously monitors regions, entities, topics, and sources; detects meaningful changes; and turns live, cited data into analyst-ready briefings, alerts, dossiers, and case files.

The subscription model should sell operational leverage, not more chat quota. Free users get enough live map/search value to trust the product. Paid users get persistent monitoring, deeper analysis, exports, custom source workflows, and briefing automation. The primary workspace remains `/` (`web/src/pages/MapPage.jsx`), with secondary pages used only for detailed review, settings, and archive/history.

## Problem Statement

Current MAPR has strong technical foundations: live ingestion, MapLibre map, Convex backend, grounded RAG, auth, Stripe billing, quotas, watchlists, alerts, bookmarks, saved views, region dossiers, entity graph, social badges, and source health. The product differentiation is not yet clear to the user:

- Free vs Pro is mostly expressed as Agent quota (`convex/functions/qa.ts`: 10 vs 200 turns/30 days).
- Important paid-value concepts already exist in separate routes (`/workspace`, `/region/:iso`, `/entities`, `/trends`) but are not woven into the main map experience.
- The map is visually central, but most analyst workflows still feel like separate screens rather than one command-and-control surface.
- The user needs a clear reason to pay beyond “more LLM questions.”

## Product Positioning

### Core Promise

> MAPR monitors live global risk signals and turns them into source-grounded analyst briefings before you know what to ask.

### Differentiation From Generic LLMs

| Generic LLM | MAPR |
|---|---|
| Pull-based: user asks each time | Push-based: watches continuously |
| Generic web/background knowledge | Live owned corpus with regional feeds |
| Often weak provenance | Every answer/source/event is cited |
| No persistent map state | Region/entity/map workbench with saved views |
| No standing watchlists | Continuous watchlists and alert rules |
| No operational brief history | Dossiers, daily briefs, what-changed views |
| No source-health awareness | Source catalog, coverage, social/unverified badges |

## Subscription Packaging

### Free Account

Purpose: prove trust, freshness, and map value.

Functional offer:

- Live global map with country coverage, event markers, region hover/click, flat/globe modes.
- Deterministic map search/filter mode with no LLM requirement.
- Recent event sheets and region snapshot.
- 10 grounded Agent questions per trailing 30 days.
- Basic citations and source badges.
- 1 watchlist, manual only.
- 1 saved view.
- 5 bookmarks.
- No scheduled alerts.
- No exports.
- No custom source ingestion.
- No daily brief automation.

### Pro Account

Purpose: sell persistent monitoring and analyst-ready output.

Functional offer:

- 200 grounded Agent questions per trailing 30 days.
- Unlimited watchlists for regions, entities, and keywords.
- Saved views and pinned map workspaces.
- Alert rules with severity thresholds, digest schedule, and email delivery.
- Daily intelligence brief generated from watchlists.
- “What changed?” mode for regions/entities/topics since last brief or selected window.
- Region and entity dossiers with timeline, source pack, entity graph, and watch-next indicators.
- Exportable Markdown/PDF/CSV brief outputs.
- Investigation/case files that collect events, notes, bookmarks, source packs, and map state.
- Custom source requests/ingestion queue, initially admin-reviewed.
- Richer provenance: source confidence, regional/source coverage quality, conflicting-source markers.

### Admin / Owner

Purpose: operate the platform.

- Unlimited Agent quota (already implemented).
- Source catalog management (`convex/functions/admin.ts`).
- Source-health dashboard and refresh controls.
- User/subscription support tools.
- Review queue for Pro custom source requests.

## Current Implementation Grounding

### Existing Surfaces to Reuse

- `web/src/pages/MapPage.jsx`: primary workspace. Owns map mode, heat layer, filters, active event, selected region, Composer, EventSheet, RegionPanel.
- `web/src/map/MaprMap.jsx`: MapLibre GL map with region click, hover state, tier choropleth, markers, arcs, coverage data.
- `web/src/components/Composer.jsx`: bottom-centered command surface. Owns quota, auth gating, Agent/Search modes.
- `web/src/components/chat/useComposerController.js`: routes user prompts to deterministic map search or grounded RAG.
- `web/src/components/RegionPanel.jsx`: in-map regional detail surface.
- `web/src/components/EventSheet.jsx`: event detail surface with auth-aware interactions.
- `web/src/pages/WorkspacePage.jsx`: current watchlists, alerts, bookmarks, saved views UI.
- `web/src/pages/AccountPage.jsx`: subscription and quota display; Stripe checkout/portal.
- `web/src/pages/RegionDetailPage.jsx`: existing region dossier basis.
- `web/src/pages/EntityExplorerPage.jsx`: entity graph basis.
- `web/src/pages/TrendAnalysisPage.jsx`: trends/anomaly basis.
- `web/src/pages/AdminPage.jsx`: source health and source admin.

### Existing Backend Capabilities

- `convex/functions/schema.ts`: users, events, articles, sourceCatalog, featureFlags, controlSignals, savedViews, alertRules, watchlistItems, bookmarks, qaConversations, qaMessages, stripeEvents, coverage, pendingBilling.
- `convex/functions/qa.ts`: free/pro/admin quota enforcement.
- `convex/functions/billing.ts`: Stripe checkout and portal.
- `convex/functions/watchlist.ts`: user watchlist CRUD.
- `convex/functions/alerts.ts`: alert-rule CRUD.
- `convex/functions/bookmarks.ts`: bookmarking.
- `convex/functions/savedViews.ts`: saved map/filter state.
- `convex/functions/digests.ts`: scheduled digest delivery foundation.
- `convex/functions/regions.ts`: region dossier foundation.
- `convex/functions/entities.ts`: entity graph foundation.
- `convex/functions/events.ts`: event list, region coverage, search/intent flows.
- `convex/functions/admin.ts`: source health and source management.
- `ingestor/src/pipeline.rs`: fetch, geocode, severity, category, entities, embeddings, Convex writes.

## Design Strategy

### Primary Design Skill Stack

Use these skills during implementation:

1. `impeccable` for product-interface craft, hierarchy, accessibility, motion discipline, and anti-generic UI checks.
2. `make-interfaces-feel-better` for micro-interactions, hover/focus states, transitions, density, shadows, and visual polish.
3. `frontend-design` for high-quality component/page execution when building new surfaces.
4. `design-iterator` for screenshot-driven refinement after the first implementation pass.
5. `design-implementation-reviewer` or `test-browser` after UI work to compare intended UX against actual behavior.

No PRODUCT.md or DESIGN.md exists today, so the first implementation phase should create a lightweight `PRODUCT.md` and `DESIGN.md` or equivalent design-context artifact before substantial UI changes. The product register is **product**, not marketing: design serves an analyst workflow.

### Visual Direction

Scene sentence: an analyst watches a live global risk board on a large monitor in a dim operations room, then prepares a source-backed brief for a client or internal team.

Design implications:

- Keep the map dominant. Panels should feel docked to the map, not like separate SaaS cards.
- Avoid generic chat UI. Agent output should look like cited intelligence artifacts: evidence rows, source packs, timelines, brief modules.
- Maintain the current tactical severity language: green, amber, red, black.
- Use amber sparingly for command readiness, not as universal decoration.
- Prefer drawers, rails, sheets, and inline overlays over modals.
- Make Pro affordances visible but non-annoying: locked rows, preview states, and “unlock monitoring” prompts inside the workflow.
- Keep free map exploration generous; gate persistence, automation, deep synthesis, and export.

### Map-First Interaction Model

The mapper page becomes a three-zone workbench:

1. **Map canvas:** live geopolitical surface, region selection, event markers, arcs, coverage.
2. **Command composer:** bottom-centered search/agent/brief/watch command surface.
3. **Context rail/sheets:** right or bottom docked surfaces for selected region/event/entity/case, with tabs for Brief, Sources, Timeline, Watch, Export.

Most work should happen without leaving `/`:

- Save watchlist from a selected region/entity.
- Create alert from current filter/view.
- Ask “what changed?” scoped to the current map/region.
- Generate a brief from selected region/view.
- Bookmark or add event to case from EventSheet.
- Export current selection from the docked panel.

Secondary routes remain for full-screen management/archive:

- `/workspace`: all watchlists, alerts, bookmarks, cases, saved views.
- `/region/:iso`: full region dossier archive/read mode.
- `/entities`: global entity graph exploration.
- `/trends`: global trends/anomalies.
- `/account`: billing/quota.
- `/admin`: source operations.

## Proposed Solution

Implement a map-first subscription workbench in phases, moving existing capabilities into the primary map workflow and adding paid features where they create durable value.

### Core Product Objects

Add or refine these domain concepts:

- **Watchlist:** persistent region/entity/keyword/topic monitor.
- **Alert rule:** watchlist or saved-view condition with severity/category/source thresholds.
- **Brief:** generated snapshot of what matters, with citations, timeline, source pack, and watch-next indicators.
- **Dossier:** durable region/entity/case intelligence artifact.
- **Case file:** user-created investigation workspace collecting events, notes, source packs, map state, and generated briefs.
- **Source request:** Pro user-submitted source, reviewed/approved by admin before ingestion.
- **Entitlement:** server-checked feature access by free/pro/admin tier.

## Technical Approach

### Entitlement Layer

Create a central entitlement module to avoid scattered subscription checks.

Backend:

- New `convex/functions/lib/entitlements.ts`:
  - `tierForUser(user): "free" | "pro" | "admin"`
  - `limitsForTier(tier)`
  - `requireEntitlement(ctx, feature)`
  - feature keys: `agent_turn`, `watchlist_unlimited`, `alert_rules`, `brief_generate`, `dossier_export`, `custom_sources`, `case_files`, `source_confidence_deep`.
- Refactor `convex/functions/qa.ts` quota constants into entitlement limits.
- Keep hard enforcement server-side. UI gating is guidance only.

Frontend:

- New `web/src/lib/entitlements.js` or hook:
  - maps quota/subscription to UI affordances.
  - exposes lock reasons and upgrade CTAs.
- MapPage and Composer use entitlement state to show previews and disabled paid actions.

Acceptance:

- Free users cannot call Pro-only mutations/actions directly.
- Pro users can access Pro features.
- Admin remains unlimited.
- UI gating matches backend gating.

### Map Workbench Shell

Enhance `MapPage.jsx` into a workbench coordinator without bloating it.

Add child components:

- `web/src/components/workbench/WorkbenchRail.jsx`
- `web/src/components/workbench/RegionWorkbench.jsx`
- `web/src/components/workbench/EventWorkbench.jsx`
- `web/src/components/workbench/WatchActionBar.jsx`
- `web/src/components/workbench/UpgradeInlinePrompt.jsx`

Responsibilities:

- MapPage owns selected object state and passes scope to panels.
- RegionPanel evolves or is wrapped into RegionWorkbench with tabs:
  - Overview
  - What changed
  - Sources
  - Watch
  - Export
- EventSheet gains:
  - Add to case
  - Bookmark
  - Source confidence
  - Related entities
  - Create alert from this event/category/region

Acceptance:

- A user can complete the main paid workflows from `/` without visiting `/workspace` first.
- Existing `/workspace` remains functional as management/archive.
- No new global sidebar is introduced.

### Watchlists and Alerts

Reuse existing `watchlistItems` and `alertRules` tables, but move creation into the map context.

Free:

- 1 watchlist item.
- Manual watch only, no scheduled alerts.

Pro:

- Unlimited watchlist items.
- Alert rules from region/entity/filter.
- Daily/instant email digest.

Backend changes:

- Add limit checks to `watchlist.add` and `alerts.create`.
- Add `watchlist.matches` query for current map scope.
- Add `alerts.preview` query to show how many current events would match before saving.
- Extend `digests.ts` to produce watchlist-scoped daily briefs using existing events/articles/entities.

Frontend changes:

- In RegionWorkbench: “Watch this region” and “Alert me” actions.
- In Composer: support commands like “watch Sudan”, “alert me on red-tier cyber in Taiwan”.
- In map-result banner: “Save this view” and “Create alert from filter”.

Acceptance:

- Free user sees one-watchlist limit with clear upgrade path.
- Pro user can create alerts from selected region, event, and filtered search.
- Daily digest only includes matching watched regions/entities/topics.

### Daily Briefs and “What Changed?”

This is the core paid differentiator.

Backend:

- New `briefs` table:
  - `userId`, `scopeType`, `scopeValue`, `title`, `summary`, `sections`, `citations`, `windowStart`, `windowEnd`, `createdAt`, `sourceEventIds`, `status`.
- New `convex/functions/briefs.ts`:
  - `generateFromScope(scope, windowHours)` action.
  - `whatChanged(scope, since)` query/action.
  - `list`, `get`, `remove` mutations/queries.
- Use deterministic rollups first:
  - event counts by tier/category/region
  - new entities
  - severity deltas
  - top cited articles
  - source diversity
- Use RAG only for narrative synthesis, never for numeric claims.

Frontend:

- RegionWorkbench tab: “What changed”
- Composer commands:
  - “brief me on the Sahel”
  - “what changed in Taiwan since yesterday?”
  - “morning brief for my watchlist”
- ChatThread should render brief-specific components:
  - headline
  - changes list
  - timeline
  - source pack
  - confidence/provenance strip

Free:

- preview of current map summary.
- no saved/scheduled briefs.

Pro:

- generate/save/export briefs.
- daily watchlist brief.
- what-changed history.

Acceptance:

- Briefs are grounded in actual event/article data.
- Numeric claims are computed server-side.
- Every citation references an existing article.
- Free users see preview/upgrade, not broken controls.

### Region and Entity Dossiers

Dossiers convert map exploration into durable intelligence products.

Backend:

- Extend `regions.dossier` with:
  - source diversity
  - top entities
  - trend deltas
  - neighboring spillover regions
  - related events timeline
  - confidence/provenance indicators
- Extend `entities.graph` or add `entities.dossier(entity)`:
  - co-occurring regions
  - related entities
  - event timeline
  - source spread
  - severity trend

Frontend:

- RegionWorkbench becomes the primary in-map dossier view.
- `RegionDetailPage` becomes full-screen read/export archive.
- Add entity click from event/brief/source rows to open entity context in map rail.

Free:

- basic region snapshot and top events.

Pro:

- full dossier, timeline, source pack, export.

Acceptance:

- Clicking a country on the map gives a useful free snapshot.
- Pro users get enough depth to replace manual copy/paste analyst preparation.
- Entity and region views share visual language and source/citation components.

### Source Confidence and Provenance

This is a key “not an LLM wrapper” differentiator.

Backend:

- Add source classification metadata to `sourceCatalog`:
  - `sourceType`: `wire | regional | official | ngo | social | user | other`
  - `verificationLevel`: `verified | mixed | unverified`
  - `countryOfOrigin`
  - `language`
  - `coverageRegion`
- Add source-confidence helpers:
  - source count
  - source diversity
  - social/unverified share
  - cross-region corroboration
  - recency
- Store or compute confidence on briefs/dossiers/events as needed.

Frontend:

- Add a compact provenance strip:
  - “7 sources · 3 regional · 1 NGO · 2 social unverified”
- Add source pack drawer with grouped citations.
- Keep existing `SOCIAL · unverified` badge behavior.

Free:

- basic citations and social badge.

Pro:

- source diversity/confidence details and exportable source pack.

Acceptance:

- Confidence is never model-invented.
- Social posts are always marked unverified.
- The UI makes uncertainty visible without blocking fast scanning.

### Investigation / Case Files

Case files make MAPR sticky and workflow-oriented.

Backend:

- Add `cases` table:
  - `userId`, `title`, `description`, `status`, `createdAt`, `updatedAt`, `lastBriefAt`.
- Add `caseItems` table:
  - `caseId`, `type`, `eventId?`, `articleId?`, `entity?`, `region?`, `note?`, `createdAt`.
- Add `caseBriefs` or reuse `briefs` with `scopeType: "case"`.
- Entitlement: case files Pro-only, or 1 read-only sample case for Free.

Frontend:

- EventSheet: “Add to case”.
- RegionWorkbench: “Start case from region”.
- Composer: “brief this case”.
- WorkspacePage: archive/manage cases.

Acceptance:

- Pro user can create a case from a map selection, add events, add notes, generate a case brief, and export.
- Free user sees the value but cannot create unlimited cases.

### Custom Source Requests

Avoid direct arbitrary crawling at first. Use an admin-reviewed request queue for safety and source quality.

Backend:

- Add `sourceRequests` table:
  - `userId`, `name`, `url`, `reason`, `region`, `category`, `status`, `adminNote`, `createdAt`, `reviewedAt`.
- Pro users can submit.
- Admin can approve into `sourceCatalog` using existing `admin.addSource` path.
- SSRF safety remains in Rust fetch layer.

Frontend:

- Map/source pack: “Missing a source? Request one”.
- Account/Workspace: source request history.
- AdminPage: request review queue.

Acceptance:

- Free users cannot submit source requests.
- Pro users can submit but not directly alter ingestion.
- Admin approval creates a disabled/enabled source with existing health tracking.

### Exports

Exports are a high-value Pro feature.

Backend:

- Add `exports.ts` action:
  - Markdown export first.
  - PDF later using server-side renderer if available.
  - CSV for event lists.
- Export objects:
  - current map filter
  - region dossier
  - entity dossier
  - brief
  - case file

Frontend:

- Export button in RegionWorkbench, brief output, case view, and saved views.
- Free users see “Copy summary” only.
- Pro users get Markdown/CSV initially; PDF can follow.

Acceptance:

- Export contains title, date, scope, computed stats, citations, source appendix.
- Export never includes uncited model claims.

## Implementation Phases

### Phase 1: Entitlements and Product Contract

Files likely touched:

- `convex/functions/lib/entitlements.ts` (new)
- `convex/functions/qa.ts`
- `convex/functions/watchlist.ts`
- `convex/functions/alerts.ts`
- `convex/functions/schema.ts`
- `web/src/lib/entitlements.js` (new)
- `web/src/pages/AccountPage.jsx`
- `web/src/components/chat/ModeSwitch.jsx`

Tasks:

- Centralize tier/limit definitions.
- Define Free, Pro, Admin features as code, not copy.
- Replace scattered quota-only thinking with entitlement checks.
- Add UI helper for locked/preview states.
- Update AccountPage to show actual plan benefits.

Acceptance:

- Server rejects Pro-only calls for Free users.
- UI copy accurately describes available features.
- Existing QA quota behavior remains unchanged except through the shared entitlement module.

Verification:

- Convex typecheck.
- Unit tests for entitlement helper behavior.
- Manual free/pro/admin flows against local auth users.

### Phase 2: Map-First Workbench UX Foundation

Files likely touched:

- `web/src/pages/MapPage.jsx`
- `web/src/components/RegionPanel.jsx`
- `web/src/components/EventSheet.jsx`
- `web/src/components/Composer.jsx`
- `web/src/components/chat/*`
- `web/src/components/workbench/*` (new)
- `web/src/index.css`

Tasks:

- Introduce docked workbench rail/sheet architecture.
- Move watch/save/alert actions into region/event/filter context.
- Keep `/workspace` as archive/manage, not primary workflow.
- Add locked Pro previews in-context.
- Preserve map dominance and avoid global sidebar bloat.

Acceptance:

- From `/`, user can select a region and save/watch/alert/export without leaving the map.
- Existing Composer and map controls remain usable on desktop and mobile.
- Free users see useful previews rather than dead buttons.

Verification:

- Browser QA for map selection, event sheet, Composer search/agent modes.
- Accessibility pass for keyboard focus, aria labels, and reduced motion.
- Visual review using `impeccable`, `make-interfaces-feel-better`, and screenshot iteration.

### Phase 3: Watchlists and Alert Creation From Map Context

Files likely touched:

- `convex/functions/watchlist.ts`
- `convex/functions/alerts.ts`
- `convex/functions/digests.ts`
- `web/src/components/workbench/WatchActionBar.jsx`
- `web/src/pages/WorkspacePage.jsx`
- `web/src/components/chat/useComposerController.js`

Tasks:

- Enforce Free watchlist/alert limits.
- Add “create alert from current scope” flow.
- Add alert preview counts.
- Route simple Composer commands to watchlist/alert actions.
- Update WorkspacePage to reflect tier limits and map-created items.

Acceptance:

- Free: one watchlist, no active alert rules.
- Pro: unlimited watchlists and alert rules.
- Alert preview matches current map filter/region/event criteria.

Verification:

- Convex tests for limit enforcement.
- UI tests/manual QA for creating/removing watchlist and alerts from the map.
- Digest dry-run with seeded watchlist.

### Phase 4: Briefs and What-Changed Engine

Files likely touched:

- `convex/functions/schema.ts`
- `convex/functions/briefs.ts` (new)
- `convex/functions/digests.ts`
- `convex/functions/rag.ts`
- `convex/functions/lib/intent.ts`
- `web/src/components/chat/ChatThread.jsx`
- `web/src/components/chat/BriefAnswer.jsx` (new)
- `web/src/components/workbench/RegionWorkbench.jsx`

Tasks:

- Add persisted briefs.
- Implement deterministic rollups for deltas, not model-generated counts.
- Add `whatChanged(scope, since/window)`.
- Add daily watchlist brief generation.
- Render brief as structured intelligence output, not generic chat text.

Acceptance:

- Pro user can generate a brief scoped to selected region/filter/watchlist.
- Output includes computed deltas, timeline, source pack, and citations.
- Free user can see limited preview but not save/schedule/export.

Verification:

- Tests for computed delta correctness.
- RAG citation validation tests.
- Browser test for prompt → brief → source links.

### Phase 5: Dossiers, Source Confidence, and Provenance

Files likely touched:

- `convex/functions/regions.ts`
- `convex/functions/entities.ts`
- `convex/functions/events.ts`
- `convex/functions/schema.ts`
- `convex/functions/lib/sourceConfidence.ts` (new)
- `web/src/components/SourceProvenance.jsx` (new)
- `web/src/components/SourcePack.jsx` (new)
- `web/src/pages/RegionDetailPage.jsx`
- `web/src/pages/EntityExplorerPage.jsx`

Tasks:

- Add source metadata classification.
- Compute source diversity/confidence rollups.
- Extend region/entity dossiers.
- Add source pack and provenance strip UI.

Acceptance:

- Every brief/dossier clearly indicates source count, diversity, social/unverified share.
- Confidence is computed from stored source metadata and event/article evidence.
- Social posts remain clearly marked unverified.

Verification:

- Unit tests for confidence rollups.
- Snapshot/manual QA of source-provenance rendering.
- Regression test that model output cannot invent confidence numbers.

### Phase 6: Case Files and Exports

Files likely touched:

- `convex/functions/schema.ts`
- `convex/functions/cases.ts` (new)
- `convex/functions/exports.ts` (new)
- `web/src/components/workbench/CaseActions.jsx` (new)
- `web/src/pages/WorkspacePage.jsx`
- `web/src/components/EventSheet.jsx`
- `web/src/components/RegionPanel.jsx`

Tasks:

- Add cases and case items.
- Add map/event/region “add to case”.
- Generate case briefs.
- Export Markdown/CSV first; PDF later if renderer is available.

Acceptance:

- Pro user can create a case, add events/regions/entities/notes, generate a case brief, and export.
- Free user sees case value but is limited.
- Export contains source appendix and computed stats.

Verification:

- Convex tests for ownership and entitlement.
- Browser QA for case creation and export download/copy.
- Export content validation against seeded data.

### Phase 7: Custom Source Request Flow

Files likely touched:

- `convex/functions/schema.ts`
- `convex/functions/sourceRequests.ts` (new)
- `convex/functions/admin.ts`
- `web/src/pages/AdminPage.jsx`
- `web/src/pages/WorkspacePage.jsx`
- `web/src/components/workbench/SourceRequestPrompt.jsx` (new)

Tasks:

- Add Pro source request submission.
- Add admin review queue.
- Approval creates sourceCatalog entries through existing admin path.
- Add status feedback to user.

Acceptance:

- Pro user can request a source.
- Admin can approve/reject.
- Approved source appears in source health and ingestion cycle.
- No direct user-supplied URL is fetched without admin approval.

Verification:

- Convex tests for entitlement and admin-only approval.
- Manual source request approval flow.
- SSRF guard remains unchanged in Rust fetch path.

### Phase 8: Polish, Onboarding, and Conversion UX

Files likely touched:

- `web/src/pages/MapPage.jsx`
- `web/src/pages/AccountPage.jsx`
- `web/src/components/UpgradePrompt.jsx` (new)
- `web/src/index.css`
- `web/src/components/chat/SuggestionRail.jsx`

Tasks:

- Add first-run map onboarding that teaches: search, watch, brief, alert, export.
- Add tier-aware suggestion prompts in Composer.
- Replace generic upgrade copy with workflow-specific value copy.
- Polish density, focus states, empty states, lock states, hover states.

Acceptance:

- A new free user understands the difference between free and Pro within the map workflow.
- Upgrade prompts are contextual and non-disruptive.
- Design review finds no generic SaaS/chat-wrapper pattern.

Verification:

- Browser smoke test for new-user flow.
- Screenshot review on desktop and mobile widths.
- Accessibility checks for keyboard and reduced motion.

## Alternative Approaches Considered

### Alternative 1: More Agent quota only

Rejected. This keeps MAPR positioned as a generic LLM wrapper. It does not create durable workflow value.

### Alternative 2: Put everything in separate pages

Rejected. Secondary pages already exist and are useful, but the user explicitly wants the mapper page to be the main work surface. Moving paid features away from the map weakens the product.

### Alternative 3: Direct self-serve custom source ingestion

Rejected for initial implementation. Arbitrary user URLs create SSRF, quality, abuse, and source-health risks. Start with admin-reviewed source requests.

### Alternative 4: Model-authored dashboards/HTML

Rejected. Existing direction is correct: Markdown/components, no model-authored HTML. Charts and counts must be computed from ground truth.

## System-Wide Impact

### Interaction Graph

- User selects region on `MaprMap` → `MapPage` sets `regionIso` → RegionWorkbench opens → queries `regions.dossier`, watchlist state, alert preview, brief history.
- User asks Composer “what changed in Sudan?” → `useComposerController` routes to brief/what-changed action → Convex computes rollups from events/articles/entities → optional RAG synthesis → structured brief rendered in ChatThread.
- User creates alert from map filter → current filter saved as savedView or alert criteria → alertRules row created → digest/alert cron evaluates against fresh events → digest output sent/stored.
- User exports region brief → export action loads brief/dossier/citations → produces Markdown/CSV → frontend offers download/copy.

### Error & Failure Propagation

- Subscription/entitlement errors must return stable codes (`FEATURE_LOCKED`, `LIMIT_EXCEEDED`, `UNAUTHENTICATED`) so UI can show precise upgrade/auth prompts.
- RAG/model failure should degrade to deterministic rollup briefs where possible.
- Digest/email delivery failure should not block watchlist/alert creation; store failure status for retry/admin visibility.
- Custom source approval should not fetch until admin approves; failed ingestion is visible through existing source health.

### State Lifecycle Risks

- Creating an alert from a transient filter can orphan unreadable criteria unless filter schema is versioned. Store a versioned filter payload.
- Brief generation can partially fail after rollups but before model synthesis. Persist `status: "failed" | "ready" | "partial"`.
- Case item references can outlive pruned articles/events. Store denormalized title/source/summary snapshots on caseItems or exports.
- Source confidence metadata must have defaults for existing sourceCatalog rows.

### API Surface Parity

- Every Pro-only backend mutation/action needs server entitlement checks, not only UI locks.
- MapPage, WorkspacePage, AccountPage, and Composer must share the same tier labels and limits.
- Admin users should bypass user-facing paid restrictions consistently.

### Integration Test Scenarios

1. Free user tries to generate a brief from a region: sees preview/upgrade; backend rejects direct action.
2. Pro user selects a region, creates alert, receives matching digest on dry-run.
3. Pro user asks “what changed in Ukraine since yesterday?” and gets computed deltas with citations.
4. Free user uses deterministic search after Agent quota depletion; search still works.
5. Admin approves a source request; source appears in sourceCatalog and source health.
6. Case export includes denormalized evidence even after source article pruning.

## Acceptance Criteria

### Functional Requirements

- [x] Free and Pro capabilities are defined in a central entitlement contract.
- [x] Free users retain useful live map/search access.
- [x] Pro users can create watchlists, alert rules, briefs, dossiers, case files, exports, and source requests.
- [x] Most paid workflows can be initiated and completed from the map page.
- [x] Briefs and dossiers are source-grounded and use computed stats.
- [x] “What changed?” works for regions, entities, and saved views/watchlists.
- [x] Source confidence/provenance is visible in briefs, dossiers, event sheets, and source packs.
- [x] Custom sources go through admin review before ingestion.

### Non-Functional Requirements

- [x] No model-authored HTML.
- [x] No uncited model claims in exported briefs.
- [x] Server-side entitlements enforce all paid features.
- [x] UI remains usable at common desktop and mobile widths.
- [x] Map performance remains acceptable with existing 600-marker cap and region coverage rollup.
- [x] Accessibility: keyboard navigation, focus visibility, semantic buttons, reduced motion support.
- [x] Security: source requests cannot bypass existing SSRF-safe ingestion model.

### Design Requirements

- [x] Map remains the dominant surface.
- [x] No generic SaaS card-grid upgrade page as the main selling mechanism.
- [x] Paid prompts are contextual and tied to workflow value.
- [x] Agent output looks like intelligence product, not chat bubbles.
- [x] Severity/provenance hierarchy is visually scannable.
- [x] Region/event/entity panels feel docked to the map.

### Testing Requirements

- [x] Convex typecheck passes.
- [x] Frontend build passes.
- [x] Rust ingestor tests still pass if source metadata changes require pipeline updates.
- [x] Unit tests cover entitlement limits.
- [x] Unit tests cover brief/delta deterministic calculations.
- [x] Integration/browser tests cover free/pro gating and key map workflows.
- [x] Manual QA verifies local Stripe checkout/portal where possible.
- [x] Browser screenshots validate map-first layout after each major UI phase.

## Success Metrics

Product metrics:

- Free → Pro conversion from contextual map prompts.
- Percentage of Pro users with at least one watchlist and one alert.
- Daily brief open/click rate.
- Export generation count.
- Repeat usage of “what changed?” and dossiers.

Quality metrics:

- Pro-only direct backend calls reject for Free users.
- Brief citation coverage: 100% of source-backed claims cite stored articles.
- Alert false-positive rate tracked through user dismissals or deactivation.
- Source request approval/failure rate.

Technical metrics:

- Map render remains smooth with event cap.
- Brief generation p95 latency acceptable for interactive use.
- Digest cron completes within Convex limits.
- No unbounded data growth beyond existing retention strategy.

## Dependencies & Prerequisites

- Stripe env must have `STRIPE_PRICE_PRO` configured.
- Resend or chosen email provider must be configured for digests/alerts.
- SourceCatalog metadata backfill needed for confidence/provenance.
- Design-context document (`PRODUCT.md`/`DESIGN.md` or equivalent) should be created before heavy UI implementation.
- Browser test harness should be available for map workflows.

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Feature bloat on map page | Main UX becomes cluttered | Docked workbench, contextual tabs, no global sidebar bloat |
| Looks like an LLM wrapper | Weak paid conversion | Emphasize watchlists, alerts, dossiers, exports, provenance |
| Backend and UI gating drift | Users see wrong capabilities | Central entitlement contract and tests |
| Model invents numbers | Trust loss | Deterministic rollups for all stats, RAG only for prose |
| Source requests introduce unsafe URLs | SSRF/security risk | Admin approval, existing Rust SSRF guard, no direct fetch from user input |
| Old events lose article refs after pruning | Broken cases/exports | Denormalize snapshots into case/export records |
| Too much work in one release | Half-finished features | Ship in phases: entitlement → map actions → briefs → dossiers → cases/export → source requests |

## Documentation Plan

Update or create:

- `README.md`: product positioning and free/pro feature table.
- `deploy/README.md`: env vars for alerts/digests/source requests if changed.
- `PRODUCT.md`: product users, value proposition, design register, anti-patterns.
- `DESIGN.md`: map-first workbench visual rules, component patterns, token usage.
- `docs/plans/` this plan as source of implementation truth.

## Implementation Notes

### Keep These Existing Decisions

- Use MapLibre GL, not bespoke SVG.
- Keep flat map top-down, pitch 0.
- Keep agent answers Markdown/components, not HTML.
- Keep source attribution clear; social is unverified.
- Keep backend-driven stats and chart data.
- Keep live data only; no demo/stub data.
- Keep single docker-compose deploy path.

### Avoid These Mistakes

- Do not sell quota as the product.
- Do not put all value behind chat.
- Do not make the map a background decoration.
- Do not create a generic dashboard/card-grid SaaS UI.
- Do not let model output become the source of record.
- Do not let Free become useless; it must demonstrate live trust.

## Sources & References

### Internal References

- `web/src/pages/MapPage.jsx`: current map-first coordinator.
- `web/src/map/MaprMap.jsx`: MapLibre rendering, events, coverage, arcs.
- `web/src/components/Composer.jsx`: Agent/Search command surface.
- `web/src/components/chat/useComposerController.js`: prompt routing and local thread control.
- `web/src/pages/WorkspacePage.jsx`: current watchlist/alert/bookmark/saved-view management.
- `web/src/pages/AccountPage.jsx`: current billing/quota UI.
- `convex/functions/schema.ts`: existing data model.
- `convex/functions/qa.ts`: current Free/Pro/Admin quota enforcement.
- `convex/functions/billing.ts`: Stripe subscription/portal.
- `convex/functions/watchlist.ts`: watchlist CRUD.
- `convex/functions/alerts.ts`: alert CRUD.
- `convex/functions/digests.ts`: digest foundation.
- `convex/functions/regions.ts`: region dossier foundation.
- `convex/functions/entities.ts`: entity graph foundation.
- `convex/functions/admin.ts`: source health/source catalog admin.
- `ingestor/src/pipeline.rs`: live source ingestion/enrichment.

### Design Skill References

- `skill://impeccable`: product interface craft, design laws, anti-generic UI checks.
- `skill://frontend-design`: distinctive production-grade frontend execution.
- Recommended supporting skills during implementation: `make-interfaces-feel-better`, `design-iterator`, `design-implementation-reviewer`, `test-browser`.

## Open Questions

These do not block Phase 1, but should be decided before later phases:

1. Should Pro include PDF export at launch, or start with Markdown/CSV and add PDF later?
2. Should custom source requests be limited by month for Pro users?
3. Should email alerts be instant, daily digest only, or both?
4. Should Team/Business tier be deferred entirely until Pro workflows prove usage?
5. Should Free users get one case file or only read-only example/previews?

## Session Log

- 2026-06-01: Initial comprehensive plan created from current repo research and prior product differentiation analysis.
- 2026-06-01: Implemented MVP across all planned product surfaces: central entitlements, map-first watch/alert/brief actions, briefs/what-changed, source provenance, cases, exports, custom source requests, account packaging, design context, tests, and browser smoke checks.
