# Mapr Redesign Blueprint

> First-principles, chat-first + bidirectionally map-integrated redesign. Grounded
> in the real stack (Convex backend, Rust ingestor, self-hosted qwen2.5:3b / bge-m3,
> MapLibre GL). Produced via a multi-agent dynamic workflow: 3 grounding audits →
> 4 independent visions → 4 adversarial critiques → 1 synthesis. **Revised against
> the web-search reality** (ChatGPT/Perplexity/Gemini now do live cited search):
> freshness is reframed as table-stakes throughout, and every "why pay" / "why
> defensible" claim is re-grounded on what a search-augmented LLM structurally
> cannot be — continuous, frozen, computed, sovereign.

## 1. Thesis & Positioning

**Thesis.** Mapr is a self-hostable, AI-first geographic **investigation watchdesk**: you ask in plain English, point at the map, and get back a source-cited intelligence product — not a chat paragraph — that you can pin, persist, watch over time, and export. The map is the conversation's working memory and pointing device; the chat is how you interrogate an **owned, continuously-ingested, geocoded, frozen-provenance corpus**. Every answer is half deterministic (counts, severity, provenance, what-changed — computed from stored rows) and half grounded generation (cited prose, leashed to retrieved articles). Mapr sells what a search-augmented LLM structurally cannot be: **continuous, frozen-baseline, computed, and sovereign** — four things a stateless prompt cannot hold no matter how current its index.

**The 5-second wedge.** *ChatGPT can search the web when you ask. Mapr watches the world when you don't — and remembers what changed, with frozen receipts you can defend.*

### The web-search objection (read this first — it reframes the whole moat)

ChatGPT, Perplexity, and Gemini now all do live web search with citations. **This means "live data" is NOT a moat and freshness is table-stakes.** Any positioning that leans on *"we show you what's happening right now"* loses — a web-search LLM does that for free. The earlier framing here was wrong and has been replaced.

The moat is not that Mapr is *live*; it is that Mapr is **continuous, frozen, computed, and sovereign** — four things a search-augmented LLM structurally cannot be, no matter how current its index:

- **Continuous, not reactive (pull vs push).** Search runs only when prompted. It cannot watch a region for weeks and *come to you* when a black-tier event appears at 3am. No persistence → no monitoring. This is now the single strongest differentiator. *(Honesty note: ChatGPT and Gemini now ship native scheduled/recurring tasks with push/email. "We run a query on a schedule" alone is no longer unique — see §7 Risk 0. What survives is the schedule **combined with** a frozen baseline diff over an owned, deterministic corpus.)*
- **Frozen baseline.** Every search is a fresh snapshot with no memory of what the world looked like when *you* started caring, so it structurally cannot answer "what changed since last Tuesday." Mapr's `watchBaselines` diff can. A scheduled search re-runs a stateless fresh query each time — no stable reference point, no known coverage.
- **Frozen provenance.** Search cites live URLs that rot, paywall, or get edited, and differ on every run; a defensible evidence trail can't rest on a link that 404s next week. Mapr's evidence is stored, deduplicated, geocoded, and re-fetchable.
- **Known, reproducible coverage.** Search returns whatever the engine surfaces — SEO-/English-/major-outlet-biased and different every time. OSINT needs to state *what is and isn't in the corpus*. Mapr ingests a defined source set deterministically; the same question over the same corpus gives the same answer.
- **Computation, not prose.** An LLM eyeballing a handful of search hits hallucinates "+240%." Mapr computes counts, severity rollups, anomaly deltas, and correlation clusters deterministically over a consistent corpus.
- **A queryable spatial object.** There is no geocoded event DB you can click, lasso, and filter by ISO to get an exact set back. The map-as-input-device loop is impossible without an owned corpus.
- **Data sovereignty.** Risk/security/NGO/sensitive users cannot send queries to a third party. Self-hosted Mapr keeps everything on the box — often the decisive factor for the ICP, independent of AI quality.

**The hard anti-pattern this implies:** Mapr must **not** try to win at ad-hoc current-events Q&A ("what's happening in Sudan today?"). That is the LLM-wrapper trap — an unwinnable fight against free products. The free tier exists only to *prove the corpus, map, and provenance are real*; every **paid** capability lives exclusively in the continuous/frozen/computed/sovereign space above. **If a feature would also work fine as a one-off web search, it is not a reason to subscribe.** This is the governing litmus test for the rest of this document.

**The ICP this implies:** monitoring/analyst users, **not** casual current-events askers (who are now fully and freely served by ChatGPT/Perplexity/Gemini). The defensible audience is whoever needs continuous watching, frozen defensible evidence trails, reproducible coverage, and/or self-hosting: risk/security teams, OSINT analysts, NGOs, journalists building a durable case. Every feature and onboarding decision is evaluated against *that* user.

**The moat, stated plainly.** A frontier LLM *with web search* can answer a current-events question with citations. It still cannot:
1. **Watch continuously and push a diff.** Standing watches over the ingest loop + cron + per-rule `lastTriggeredAt` deliver change *to* you; search only responds when asked. (And where scheduled-task push now exists, it cannot push a *diff against a frozen owned baseline* — only a fresh stateless re-query.)
2. **Hold a frozen baseline.** "What changed since *you* started watching" requires durable per-user state (`watchBaselines`) diffed against a continuously-updated corpus.
3. **Freeze and own its corpus + provenance.** The Rust ingestor dedupes, geocodes, severity-scores, NER-tags, correlates, and embeds a *defined* source set into stored, re-fetchable rows — known coverage, stable citations, reproducible results.
4. **Compute, not narrate, the trust layer.** Source-strength verdicts and severity rollups come from `summarizeSources` + deterministic aggregation, not model prose a clone (or a search LLM) can fabricate.
5. **Be self-hosted and unmetered.** Analysts and small risk/NGO teams own the box; we sell the persistent, sovereign workflow, not quota.

The defensibility ranking across the four visions converges here: **Investigation-First + Live-Monitoring-First are the two highest-scoring, most-defensible framings** (defensibility 8, chatMapIntegration 8–9). This blueprint fuses them — *investigation as the act, monitoring as the persistence* — and harvests the Intelligence-Product card surface and Collaboration boards as supporting structure. It hard-cuts the overclaims all four critiques flagged: **forecasting, cross-region contagion, source-disagreement NLP, animated tier-climb history, and "client-ready multi-section prose."**

---

## 2. The Core Experience

### The default screen (chat-first, but the map is alive)

Cold open: a **near-full-bleed MapLibre globe** (`MaprMap`), dimmed to ~30%, slowly rotating, rendering the **owned corpus, continuously ingested** — current `events.list` markers by tier (green/amber/red/black) and a faint 72h heatmap. The map **fills the screen and is never hidden behind a chat view**. *(Freshness here is assumed, not the pitch — the markers being current is table-stakes. The value is what the system has already **computed** about them.)* So the first thing the screen communicates is not "the map is fresh" but **"the system already noticed something"**: the three computed starter chips below load *before* any prose.

The single primary input is **docked bottom-center over the map** — the position the current `Composer.jsx` already occupies — large, inviting, the first thing the eye and cursor land on: *"Investigate or watch a region, event, or entity…"*. This is the Perplexity-style single-input moment, **but pointed at an owned, reproducible corpus you can watch over time — not the open web.** The input scopes into a known corpus, not the live internet. The map stays the persistent canvas; the composer floats above it.

Directly **above the input** sits the **Context Stack** — a row of removable typed chips showing exactly what geography/time the AI is currently looking at (see §4.1). Below/around the input: three **computed starter chips** (not generic prompts) seeded at load from `computeAnomalies` + `computeRegions` — e.g. *"Sudan: conflict signals +240% vs prior 72h — what's driving it?"*. The first impression is that the system already noticed something — computed movement, not the latest headline. A thin clickable ticker runs along the bottom edge: **the top movers — events whose severity changed most vs the prior window** (from `computeAnomalies`), each clickable to *watch this* or *investigate the change*. Even the ambient ticker shows computed deltas, not a raw news crawl.

No nav bar of competing pages. Secondary surfaces collapse into a thin left spine (drawers, not routes). The composer owns the bottom-center; the map breathes behind it.

### The bidirectional loop (the heart of the redesign)

The current code is **one-directional**: `MaprMap` is render-only (verified: it exposes only `onEventClick`/`onRegionClick`), and `deriveMapReaction()` (mapContext.js:159-222) mines question/answer text *post-facto* with brittle regex. We replace this with one **shared `InvestigationContext` reducer** (killing MapPage's 5 fragmented `useState` hooks: `filterIds`/`scope`/`activeEvent`/`regionIso`/`mapFocusIso` — and fixing the regionIso/activeEvent half-reset bug). It holds a typed, visible **Context Stack** rendered as removable chips directly above the input. The user always *sees* what geography/time the AI is looking at and can edit it before asking.

**(a) User types a question.** Text resolves through `lib/intent.parseQuery` for fast deterministic scope (region/tier/category). The chip stack is merged in as *exact* structured scope, so the AI no longer guesses "Egypt-the-place" vs "Egypt-the-word." Retrieval (`rag.retrieve`, hybrid semantic + lexical) runs scoped to those `isoA2` + `recencyBucket` filters **over the OWNED corpus — same scope, same corpus = same answer, reproducible, unlike a fresh web search.** Mapr **first computes the deterministic layer** (counts, severity mix, what-changed-vs-baseline) over those exact rows; **then** generation (`rag.generate`) produces citation-enforced prose leashed to the retrieved articles. The map flies to scope, paints the choropleth, and drops numbered evidence pins matching the `[n]` citations — and the answer carries **Watch this scope** / **Pin to Case** affordances, so the question becomes a standing monitor, not a one-off.

**(b) User clicks an event.** A new `onEventContext(event)` callback writes the event's `eventKey` + `isoA2` + entities + tier into the Context Stack as a chip (*"IDF strike, Rafah · RED-8.2"*). The input placeholder rewrites to *"Ask about this event…"*. Clicking no longer just opens a read-only `EventSheet` — it loads the cluster as **live chat context**. The exact event-id set is passed to retrieval (no regex).

**(c) User selects/draws a region.** Two tiers, deliberately scoped by buildability (see §7):
- **Clicked ISO + viewport bbox (Phase 1, cheap):** a new `onViewportContext`/`onRegionClick` emits a REGION/AREA chip resolving to a set of `isoA2` codes.
- **Freehand lasso/polygon (Phase 3, net-new):** requires adding a draw library + client-side point-in-polygon hit-testing — *not* present today (`maplibre-gl ^5` only, no MapboxDraw/terra-draw/turf — verified). **Decision: a drawn polygon resolves to the set of intersecting `isoA2` codes, then filters at ISO granularity.** Convex's vector index filters on equality fields only (`recencyBucket` + `isoA2`); arbitrary bbox is a range query the index cannot do. We are honest that sub-country corridors (e.g. the Red Sea) post-filter `lon`/`lat` after a 4× overfetch rather than filtering the index. ISO/event-id scope is exact; arbitrary geometry is best-effort.

**(d) User explores a hotspot.** Hovering surfaces a **ghost chip** with a suggested question pulled from `computeAnomalies` (*"Why is Lebanon amber-tier this week? — severity +X% vs baseline"*) that the user can click to pin into the stack.

**Forward (chat → map).** Answers return *structured map directives* (fly-to, highlight eventKeys, set tier filter, paint overlay) — not regex-mined text. Hovering citation `[3]` in the card pulses pin 3 on the map and vice-versa. Card and map are two renderings of one cited evidence set.

### What an answer looks like — an intelligence product, not a chat bubble

Every response renders as an **Investigation Card** with a fixed anatomy, recomposing existing primitives (`ChatMessage`, `EvidenceEventRow`, `CitationTray`, `FacetSummary`):

1. **BOTTOM LINE** — one bold sentence (the `rag.ts` system prompt already enforces this).
2. **CONFIDENCE STRIP** — a *computed*, non-generated verdict from `summarizeSources`: *"HIGH · 6 sources · 2 verified · 1 social unverified."* Color-coded. **Labeled "Source Strength / Corroboration," never "Confidence %"** (a calibration claim the system can't back — per the Foresight critique). The verdict is computed over a **known corpus**, so it can state coverage bounds a search LLM cannot.
3. **COMPUTED FACTS** — counts, severity mix (`FacetSummary`), top entities — from deterministic rollups, *not* the LLM.
4. **EVIDENCE ROWS** — `EvidenceEventRow` cards, each with severity pill, source, age, `[n]` marker, expandable facts; checkbox-selectable to pin into a Case.
5. **WHAT-CHANGED** — a delta line from `computeAnomalies` (*"cyber +180% vs prior 7d"*), framed as backward-looking measured movement.
6. **SOURCE PACK** — `CitationTray` with `verificationLevel` badges.
7. **NEXT MOVES / EXPORT BAR** — deterministic follow-up chips + action dock: *Pin to Case · Watch this scope · Set alert · Generate brief · Export*.

The thread grows **upward from the bottom-center composer**, stacking Investigation Cards over the map (which stays the backdrop and remains the active participant — clicks still mutate context mid-thread). The card stack scrolls independently; the composer stays pinned at the bottom. This vertical stack of cards *is* the investigation log, persisted to `qaConversations`/`qaMessages`, promotable to a Case at any point.

---

## 3. Information Architecture

Today's 9 routes (`MapPage`, `/intel`, `/trends`, `/entities`, `/workspace`, `/region/:iso`, `/event/:id`, Account, Admin) collapse into **one console + three contextual drawers + two utility routes**.

| Today | Becomes |
|---|---|
| `MapPage` (`/`) | **The Console** — bottom-center input over a full-bleed map, cards stacking upward, a thin left spine. Absorbs ambient awareness as **computed Signals** (anomalies, watch hits) rather than a raw news feed — see the SIGNALS drawer. Composer lifted out of MapPage, driven by `InvestigationContext`. |
| `/intel`, `/trends` | **Card types**, not pages. `intel.overview` renders as a Situation card's computed-facts strip; `trends.series` renders as inline `AnomalyRows` in a "What's Moving" card. *(These deterministic views are the "computed, not narrated" moat — they remain directly reachable, not only summonable by prose; see §7 Q2.)* |
| `/entities` | **Entity lens inside an investigation** — clicking an entity chip opens an in-context Dossier card overlaying co-occurrence arcs on the map. |
| `/workspace` | **CASES drawer** + **SIGNALS drawer**. Cases/briefs are the deliverable library; Signals is the push side (anomalies, watch hits, fired alerts), each a "start investigation here" button. This is where "what's new" lives — framed as computed signals, not a passive feed. |
| `/region/:iso`, `/event/:id` | **In-map evidence sheets** (`EventSheet`) — deep-linkable for sharing, but in-app they open as overlays, never a full nav away. |
| Account, Admin | **Kept as genuine utility routes** (the only real page navigations left). |

**Navigation model:** verbs change from *"go to a page"* to *"open a case / open a signal / promote a finding."* Three drawers orbit the same map and share `InvestigationContext`: **CASES** (resumable investigations), **SIGNALS** (anomalies + watch hits + alerts), **ENTITIES** (in-context dossiers). Nothing competes with chat+map; everything seeds it or persists from it.

### Reconciling "chat-first" with PRODUCT.md's "Map first / do not make the map decorative"

This is the central tension and it is resolved by **rejecting the false binary**. PRODUCT.md line 18 says *"Map first: the main working surface is the mapper page"* and line 26 *"Do not make the map decorative behind a chat app."* The founder's new mandate is chat-first. The synthesis:

> **Chat is the entry point; the map is the working surface; the answer lives on both.**

The map is *not* decorative because it is **load-bearing in both directions**: it is the primary **input device** (clicking/selecting/drawing writes exact structured scope the AI consumes — this is the Context Stack, the thing a clone with no corpus and no map cannot offer) and the primary **output canvas** (answers fly the camera, pin cited evidence, paint choropleths, draw correlation arcs). A chat that filtered a decorative map would violate PRODUCT.md; a chat whose every turn *mutates and reads from* the active/working map honors it. The bottom-center input is the **5-second on-ramp**; within one interaction the user is working on the map. We keep the spirit of "map first" (the map is where intelligence is collected and read) while delivering "chat first" (conversation is how you drive it).

---

## 4. Differentiated Capabilities

Eight capabilities, de-duplicated from 28 across the four visions, prioritized by the critiques' scores and buildability. Overclaims cut or reframed. **Every "Why defensible" below rests on continuous / frozen / computed / sovereign grounds — never on "we're live" or "we cite sources" (a web-search LLM does both); the point is frozen, known-coverage, reproducible provenance.**

### 4.1 Context Stack — bidirectional map↔chat scoping `FREE`
**What.** A visible, editable row of typed chips above the input (REGION/AREA/EVENT/ENTITY/TIME). Map gestures write into it; the next question inherits exact structured scope. The input placeholder adapts to context.
**Why defensible.** A search-augmented LLM has **no owned, geocoded, queryable event corpus to point at and no map as an input device.** Clicking or lassoing returns an **exact row set** (`eventKey`/`isoA2`) — a queryable spatial object, not a phrase the model parses. This is moat pillar 4 (the queryable geocoded spatial object): the scope is a set *returned from an owned spatial index*, not a text guess. It is a UI+data primitive, not a prompt.
**AI+geography fusion.** *This is the integration.* The map becomes an input device; the answer mutates the map back.
**Builds on.** Replaces `mapContext.deriveMapReaction()` + MapPage's 5 `useState` hooks with one `InvestigationContext` reducer; new `MaprMap` callbacks (`onEventContext`/`onViewportContext`) alongside existing `onEventClick`/`onRegionClick`; feeds `rag.retrieve` filters + `intent.parseQuery`.
**Tier.** Free — this is the trust-proving core loop, and it is free precisely *because* the queryable-spatial-object grounding (which a search LLM structurally lacks) makes the free loop believable enough to sell the paid layer. *(Founder idea: "location-aware conversations" — survived, this is its mechanism.)*

### 4.2 Investigation Cards with computed Source-Strength verdict `FREE`
**What.** Every answer is an intelligence product (bottom line · source-strength strip · computed facts · cited evidence rows · source pack · next moves), never a chat bubble.
**Why this is a credible free trust-prover (not a paid moat).** A one-shot question→cited-card is a shape a web-search LLM can match today, so this stays deliberately **Free** — it is the trust-prover, not a paid claim. What a search LLM *cannot* match is what makes the free card believable: **a search LLM cites whatever live URLs it surfaced this second — links that rot, paywall, get edited, and differ on every run, from an unknown and SEO-/English-biased coverage set. Mapr's citations resolve to stored, deduplicated, geocoded, re-fetchable rows from a DEFINED source set: the same question over the same corpus returns the same evidence, and the trail still resolves next week.** The moat is **frozen, reproducible, known-coverage provenance** — not merely that a claim is cited. The source-strength verdict is **computed over a known corpus** (`summarizeSources` over `sourceCatalog` metadata, *not* LLM prose), so it can state coverage bounds a search LLM cannot. This reproducibility + known coverage + computed source-strength is exactly what makes the free card credible enough to sell the paid continuous/frozen layer.
**AI+geography fusion.** Each `[n]` citation is also a map pin; hovering a row pulses its marker; source-strength tints the choropleth so thinly-sourced regions look visibly weaker.
**Builds on.** `rag.ts` (enforced `[n]` + bold bottom line), `lib/qa` (`referencedIndices` + corrective retry), `lib/sourceConfidence`, `EvidenceEventRow`/`CitationTray`/`FacetSummary`.
**Tier.** Free. *(Founder: "source verification" — survived as the deterministic half; the NLP "disagreement detection" sub-claim is CUT per critique — a 3B CPU model does stance detection unreliably.)*

### 4.3 Living Case Files — resumable, map-restoring investigations `PRO`
**What.** Any conversation promotes to a Case; evidence rows are checkbox-pinned into `caseItems`. Re-opening a case replays its Context Stack and re-plots its pinned events on the map — an investigation is a resumable spatial workspace, not a lost chat.
**Why defensible.** Persistence + frozen provenance is the structural moat (pillars 1 and 3): **a search LLM is stateless and pull-based; it cannot hold a resumable, exportable evidence trail whose citations still resolve weeks later.** A case is an exportable, defensible evidence trail tied to **stored, re-fetchable corpus rows** — so the trail reproduces later, not "live" rows that may have moved. Incumbents that do this are six-figure sales-gated.
**AI+geography fusion.** Cases store/restore map state via `savedViews` (`filterState`+`mapState` JSON); opening a case flies the map back to the scene with evidence re-pinned.
**Builds on.** `cases`/`caseItems` + `cases.addItem` (already accepts event/article/entity/region/note), `savedViews`, `exports.ts` case→Markdown.
**Tier.** Pro. *(Founder: "geopolitical workspaces" + "map-driven investigations" — survived, merged here.)*

### 4.4 Standing Watches with Baseline Diff Engine `FREE create / PRO diff`
**What.** Create a persistent named Watch from one sentence or by pinning an investigation's scope. On creation, **snapshot a frozen baseline** (matching event set + severity rollup + timestamp). On each ingest cycle, diff the new world against that frozen baseline and emit a **Change Report**: new events (`firstSeenAt` > baseline), resolved events, severity deltas, new correlated articles. The product's primary output for a watch is a **diff**, not an answer.
**Why defensible.** This is the canonical embodiment of moat pillars 1 (continuous/push) and 2 (frozen baseline) — the single thing a frontier LLM with live web search structurally *cannot* do: it has no frozen reference point from when *you* started caring. "What changed since I started watching" requires durable per-user baselines + a continuously-updated owned corpus. Even a scheduled-task LLM re-runs a stateless fresh query with no stable baseline and no known coverage.
**AI+geography fusion.** A watch is a saved map+scope (region/bbox/window/entities). Changed markers pulse with a "NEW since baseline" ring; opening a watch flies to the triggering events and restores the camera.
**Builds on.** `watchlistItems` + `alertRules` (region/entity/keyword/category/severity scopes), `crons.ts` hourly sweep, `digests.ts` matching/templating, `recomputeEvent` tier escalation, `savedViews` for scope storage.
**⚠ NET-NEW INFRA (honesty flag).** All four monitoring critiques caught the same mis-attribution: **`computeAnomalies` is a *rolling* prior-window-vs-active count delta per category — NOT a frozen per-user baseline** (verified: intent.ts:304, no baseline/snapshot table in schema). The frozen baseline requires a **new `watchBaselines` table** storing each watch's event-set + rollup at creation, plus a re-snapshot policy. This is buildable but must be scoped as new infrastructure, not reuse.
**Tier.** Creating/viewing a watch and the in-app NEW-marker stream are Free (proves the "it kept watching" magic — the continuity proof, not a metered teaser). The full Baseline Diff Report is Pro. *(Founder: "event timelines" + monitoring — survived strongly.)*

### 4.5 Proactive Watch Firing + In-App Alert Stream `FREE stream / PRO email`
**What.** Watches fire on their own when a threshold crosses, surfacing as a live in-app stream and (Pro) email digest, each deep-linking to the Change Report on the map.
**Why defensible.** Push, not pull (moat pillar 1). An LLM only responds when prompted; it cannot wake you at 3am because a black-tier event appeared in your watched region. Requires the cron + ingest loop + per-rule `lastTriggeredAt` state Mapr already runs. *(Where native scheduled tasks now exist, what they push is a fresh stateless re-query — not a diff against an owned frozen baseline; Mapr messages the **diff**, not the **schedule**.)*
**AI+geography fusion.** A fired alert is a deep-link into the console: opening it flies the map to the triggering event and renders the Change Report. The alert *is* a map+chat state.
**Builds on.** `crons.ts` sweep, `digests.ts` `digestMatches`/`watchlistMatches` (verified reusable), `alertRules.lastTriggeredAt`, `controlSignals.refreshRequested`, Resend pipeline.
**⚠ Gate prose behind click.** Deterministic match is cheap; rendering a Change Report invokes RAG on `qwen2.5:3b`. **Decision: auto-generate the *deterministic* diff on fire; generate the *prose synthesis* only on explicit user click** — else bursty 15-min ingest cycles queue many generations and the local model becomes the bottleneck. The deterministic diff IS the product; prose is decoration.
**Tier.** In-app stream Free; email/scheduled digests Pro.

### 4.6 Correlation Tracer — deterministic link analysis on the map `PRO`
**What.** Ask "are these connected?" on selected events and Mapr draws the actual links: events sharing an ingestor `eventKey`, events inside the 72h/region/Jaccard correlation cluster, and entities co-occurring across them — rendered as arcs between markers with a ranked link-evidence list.
**Why defensible.** Computed, not narrated (moat pillar 4): **a search LLM can narrate that two events seem related from a few hits; it cannot deterministically compute and reproduce the cluster.** Mapr's arc is a computed link over an **owned, deduplicated corpus with stable `eventKeys`** (`correlate.rs` clusters + `entities.graph` co-occurrence edges) — same corpus, same graph, every time.
**AI+geography fusion.** The answer is primarily a map mutation (arcs + overlay) paired with a card listing link evidence; clicking an arc opens the shared articles.
**Builds on.** `correlate.rs` `eventKey` clusters, `entities.graph` edges, `events.entities` (NER).
**⚠ Scope decision.** Ship the **deterministic-cluster tracer only**. The "semantic links via cross-article embedding distance" half is real new vector work and the part most exposed to false-positive arcs — **treat as experimental Phase 4, behind a flag.** *(Founder: "multi-source correlation" — survived as the deterministic half.)*

### 4.7 Escalation Chronology — narrative time-arc `PRO`
**What.** For an event cluster, "show me how this developed" assembles the time-ordered chain of corpus articles into a scrubbable timeline; scrubbing drives the map (markers appear/grow by `publishedAt`).
**Why defensible.** Reproducible + drives the owned map: **a search LLM can sketch a timeline from whatever hits it found this run; it cannot reproduce the same dated chain over a defined corpus, nor drive a map with it.** Mapr's chronology is a reproducible, dated sequence over an **owned `eventKey` cluster** that **scrubs the spatial object** (markers move) — combining the reproducibility pillar with the queryable-spatial-object pillar that a stateless, map-less search LLM lacks.
**AI+geography fusion.** Time becomes a shared chat+map axis; the active citation lights the current pin.
**Builds on.** `articles` `by_publishedAt` index + `eventKey` clustering, `recencyBucket` windows, `EvidenceRows`.
**⚠ Reframe (honesty flag).** All critiques caught this: events store only **current** tier + `firstSeenAt`/`lastUpdatedAt` — **no per-step severity history** (verified). The animated green→red→black "tier climb" would be partly synthetic. **Decision: ship as a deterministic chronology of dated cited articles ("here is the sequence of reports"), NOT an animated severity-climb reconstruction.** Drop "multi-document synthesis" language — it's a chronology, not LLM narrative reasoning. *(Founder: "event timelines" — survived, descoped to honest chronology.)*

### 4.8 Shared Boards — collaborative spatial workspace `PRO`
**What.** A Board is a persistent, shareable spatial document: pinned Cards, watch-scopes, and case evidence anchored to geography and time. Opening a board rehydrates the exact camera, filters, and chat context; teams reason on the same board; Convex subscriptions stream updates live.
**Why defensible.** Persistent, geo-anchored, multi-user memory is exactly what a stateless search LLM lacks (persistence + collaboration are not search-replicable, moat pillar 1). The value sold is shared institutional memory.
**AI+geography fusion.** The map IS the board canvas; cards are pins at coordinates. A teammate clicking a pin loads its scope into their own chat to continue.
**Builds on.** `savedViews` (filterState+mapState JSON) + `shareToken`, `cases`/`caseItems`, `briefs`, Convex real-time subscriptions.
**⚠ Scope decision.** `savedViews` is single-user JSON today. **Real-time multi-user editing (presence, pin-conflict resolution, ACL) is net-new product surface, not a recompose — defer to Phase 4+.** Ship **share-a-board (read + fork)** first via `shareToken`; live co-editing later. *(Founder: "collaborative boards" — survived, phased.)*

### What is CUT or hard-reframed (per critiques)
- **Predictive / forecast / 7-day likelihood** — **CUT.** No forecasting model exists; `computeAnomalies` is a backward count delta with a degenerate `+100%` when baseline=0. Branding this as prediction invites the exact credibility failure the provenance moat prevents. (Note: cut because Mapr has no backing math — *not* because search can't forecast; do not re-inflate "forecasting" into a differentiator.) Reframed everywhere as **"what's escalating now / measured trend."** *(Founder: "predictive trend analysis" — does NOT survive as prediction; survives only as measured-anomaly surfacing.)*
- **Cross-Region Contagion Lens** — **CUT.** Zero backing math; correlation is single-region title-Jaccard; "contagion edges" would be LLM speculation dressed as computed intelligence — the least defensible feature.
- **Source-disagreement / stance detection** — **CUT** (3B CPU model unreliable). And even with a capable model, eyeballing source disagreement over retrieved hits is a **narrated, non-reproducible output a free web-search LLM already does** — it fails the litmus test. Keep only the deterministic sourcing breakdown computed over the known corpus.
- **Entity canonicalization ("Putin" = "Vladimir Putin")** — **deferred, not promised.** Real NLP work; until built, entity chips/watches operate on raw case-insensitive NER strings and we don't oversell entity-targeted watches.

---

## 5. Monetization & Tiering

**Principle: Free proves trust — Free's job is to prove the corpus/map/provenance are real (clickable geocoded events, stable reproducible citations, deterministic counts), NOT to be a free current-events Q&A engine. Pro sells the continuous, frozen-baseline, computed, and sovereign workflow — the things that compound over time and can't be cloned by a prompt.** No paid value rests on anything a free web search does.

| | **Free** (prove the moat is real) | **Pro** (the durable product) |
|---|---|---|
| **Chat + Context Stack** | Full bidirectional loop, click/select scoping | — |
| **Investigation Cards** | Full cards, source-strength verdict, citations | — |
| **Watches** | Create + view watches; in-app "NEW since baseline" markers | **Baseline Diff Reports** (full change synthesis), scheduled email digests |
| **Continuous monitoring** | — | **Unmetered standing watches + automated diffs/digests** (the persistence layer) |
| **Cases** | — | Living Cases, map-restoring, exports (Markdown/CSV) |
| **Correlation / Chronology** | — | Correlation Tracer, Escalation Chronology |
| **Collaboration** | — | Shared Boards (share + fork; live co-edit later) |
| **Alerts** | In-app alert stream | Email/Resend digests, scheduled cadence |
| **Sovereignty** | — | Self-hosted deployment — sensitive ICP keeps all queries on the box |
| **Interactive limit** | Generous fair-use interactive allowance | Fair-use compute guardrail (self-hosted) |

> **On the interactive limit:** the cap on ad-hoc messages is a **fair-use compute guardrail on the self-hosted box, not a value lever.** Volume is explicitly **not** the reason to pay — paying for "more answers" would be paying for a worse Perplexity. The reason to pay is **persistence, automation, and sovereignty** (unmetered continuous watches, automated baseline diffs/digests, self-hosting). Nothing in this table reads as "pay to ask more."

**Why Pro can't be trivially replicated.** Every Pro feature depends on **durable state diffed against a continuously-running owned ingest pipeline** (baselines, watches, cases, boards) — not a prompt. A competitor would have to stand up and run the Rust ingestor + per-user Convex state + cron sweep. The free tier deliberately *shows* the magic (the corpus is real, citations are real and reproducible, the map reacts) so the user believes the persistence layer is worth paying for — it is the trust-prover, not a metered answer engine. **We sell persistence and sovereignty, not quota** — exactly the competitive wedge.

---

## 6. Implementation Roadmap

### Phase 1 — The Chat+Map Core Shell (the foundation; everything depends on it)
The big refactor. Honestly scoped as a multi-week frontend rewrite, not incremental wiring.
- **Frontend (net-new + re-parent):**
  - Build `InvestigationContext` reducer; **delete** MapPage's 5 `useState` hooks and `mapContext.deriveMapReaction()`. Fixes the regionIso/activeEvent reset bug.
  - Lift `Composer`/`useComposerController` out of `MapPage` so it's route-independent; keep it **docked bottom-center** over the full-bleed map, with cards stacking upward.
  - Add `MaprMap` callbacks: `onEventContext`, `onViewportContext` (alongside existing `onEventClick`/`onRegionClick`). **Reuse:** the existing render pipeline, marker layers, fly-to.
  - Build the Context Stack chip bar (above the input) + adaptive placeholder.
  - Build the Investigation Card surface by **recomposing** `ChatMessage`, `EvidenceEventRow`, `CitationTray`, `FacetSummary` (these exist but lack context providers — wiring them into cards is real work).
  - **Pull the FREE half of Watches forward into Phase 1:** create-a-watch from chip scope + the in-app "NEW since baseline" marker stream (keys off `firstSeenAt` vs baseline ts — cheapest possible proof of continuity). This is the *one* thing that keeps Phase 1 from being "a geocoded Perplexity." It proves the continuous/frozen story exists from day one.
- **Backend (mostly reuse + minimal net-new for the free watch):** wire chip scope into `rag.retrieve` (`isoA2` + `recencyBucket` filters already exist) and `intent.parseQuery`. **Reuse** `rag.ts`/`lib/qa` citation enforcement, `lib/sourceConfidence`. Stand up the minimal `watchBaselines` write-on-create needed for the free NEW-marker stream (the full diff engine is Phase 2).
- **Ingestor:** no change.
- **Ship gate.** The bidirectional loop works for click/ISO/viewport scope; answers render as cards with computed source-strength; **a created watch shows in-app NEW-since-baseline markers.** ⚠ **The Q&A-only slice of Phase 1 is intentionally NOT a launchable value prop** — chat + cards alone is a geocoded one-off-search surface that would lose to Perplexity (it fails §1's litmus test). Do **not** user-test "is this better than Perplexity?" The defensible product begins where continuity does, which is why the free watch + NEW-marker stream is pulled into this phase: the foundation gate must prove *it kept watching*, not just *it answered*.

### Phase 2 — Persistence & Push (the Pro moat)
- **Backend (net-new + reuse):**
  - **NET-NEW: `watchBaselines` table** (full) + snapshot-on-create + re-snapshot policy. Build the diff query (new/resolved/escalated against frozen baseline). **This is the single most moat-critical line item in the roadmap; it does not move later.**
  - **NET-NEW (prerequisite of the Baseline Diff Report, ships *with* the diff engine): the lexical/ID-keyed fetch path for changed articles** — so diff-RAG retrieval doesn't depend on changed articles surfacing in top-k vector candidates (recall risk flagged by critique). Without it the Change Report can't reliably retrieve what changed, so it must ship alongside the diff, not after.
  - Generalize `crons.ts` sweep to evaluate watches per cycle; **gate prose generation behind user click**, auto-generate only the deterministic diff. **Reuse** `digests.ts` matching, `alertRules`, Resend.
  - Living Cases: **reuse** `cases`/`caseItems`/`cases.addItem` + `savedViews` for map restore + `exports.ts`.
- **Frontend:** Full Baseline Diff Report card; in-app alert stream; CASES + SIGNALS drawers. (Watch creation + NEW-marker rings already shipped in Phase 1.)

### Phase 3 — Geographic depth & monitoring authoring
- **Frontend (net-new dependency):** add a MapLibre draw stack (terra-draw or equivalent) + client-side point-in-polygon for lasso/draw-to-scope and draw-to-watch. **Resolve polygons to `isoA2` sets**; post-filter `lon`/`lat` for sub-country corridors (vector index can't range-filter — confirmed).
- **Frontend:** Correlation Tracer (deterministic clusters + `entities.graph` arcs); Escalation Chronology (deterministic, honest chronology — no synthetic tier climb).
- **Backend:** Entities-as-context-chips + in-context Dossier cards (`entities.dossier`/`graph`).

### Phase 4 — Collaboration & experimental signal
- Shared Boards: share+fork via `shareToken` first; live multi-user co-edit (presence, ACL, conflict resolution) is net-new and last.
- **Experimental, flagged:** semantic correlation links via cross-article embedding distance — speculative, may not ship.
- **Computed (moat-relevant, not speculative — pull earlier if cheap):** per-region anomaly scoring (extend `computeAnomalies` beyond per-category). This is "computed, not narrated" value, not a speculative experiment like semantic correlation; keep it separate from the flagged work so the "experimental, may not ship" framing doesn't taint a defensible computed feature. **No "predictive/forecast" framing ships.**

### What reuses vs. what's net-new (at a glance)
- **Reuses (low risk):** all UI primitives, `rag.ts`/`lib/qa`/`lib/sourceConfidence`, `intent.parseQuery`, `cases`/`savedViews`/`alertRules`/`watchlistItems`, `crons`/`digests`/Resend, `correlate.rs`/`entities.graph`, `exports.ts`, Convex subscriptions, the MaprMap render pipeline.
- **Net-new (the real cost):** `InvestigationContext` rewrite, MaprMap emit callbacks, Card surface composition, **`watchBaselines` table + diff engine + changed-article lexical fetch path (Phase 2, together)**, watch-per-cycle eval gating, **map draw/lasso library + point-in-polygon**, live board collaboration, entity canonicalization (deferred).

---

## 7. Risks & Open Questions

**Top risks**

0. **The commoditized-Q&A trap (the LLM-wrapper death) — existential, lead position.** ChatGPT/Perplexity/Gemini now do live web search with citations for free. If Mapr's free tier presents as general current-events Q&A, it is a strictly worse Perplexity and users churn before discovering the paid moat. Every other risk below is about whether Mapr can be *built*; this is the only one about whether it can *win*. **Mitigation: the free tier's job is not to answer better than search — it is to *prove the corpus/map/provenance are real* (clickable geocoded events, stable reproducible citations, deterministic counts). Onboarding must surface a Watch (continuous) and a Change Report (frozen-baseline diff) early, because those are the only things a free search-LLM structurally cannot do. Litmus test for every free-tier surface: if it would work fine as a one-off web search, it is selling the wrong story.** Two corollaries: **(a)** scheduled-task/push is no longer unique — ChatGPT and Gemini now offer native recurring tasks with push/email; what they *cannot* do is hold a frozen baseline and diff it against an owned, deduplicated, geocoded corpus, so **message the *diff*, not the *schedule***; **(b)** the ICP must be monitoring/analyst users (risk/security, OSINT, NGOs, journalists building a durable case), **not** casual current-events askers, who are now fully and freely served by search-LLMs — chasing them is the wrapper trap. Every feature and onboarding decision is evaluated against the analyst, not the casual asker.
1. **Self-hosted CPU LLM (qwen2.5:3b, 384-token cap, 60s timeout) — quality & latency.** The entire moat is *correctly* routed to deterministic code (source-strength, what-changed, clusters, anomalies); the 3B model is leashed to cited prose only. **Mitigation: keep the model on the prose-only leash the current `rag.ts` prompt enforces; never promise "client-ready multi-section briefs" or "synthesis" the model can't reliably produce; gate every auto-fire prose generation behind a user click.** The biggest latency risk is bursty watch-firing — solved by deterministic-diff-on-fire, prose-on-demand. (Sovereignty upside: keeping inference on the box is itself a moat for the sensitive ICP, independent of model quality — see §1 pillar 5.)
2. **The map-as-decoration trap (the PRODUCT.md violation).** A chat that merely filters a pretty map fails the mandate. **Mitigation: the Context Stack makes the map a genuine *input device* — gestures write exact structured scope the AI consumes. If a feature doesn't make the map load-bearing in both directions, it doesn't ship in the core.**
3. **Scope / effort honesty.** Three of the four visions framed a multi-week rewrite (collapse 9 routes, replace 5 `useState` hooks, lift Composer, re-parent every component) as incremental wiring. **Mitigation: Phase 1 is explicitly the rewrite; downstream phases are additive.**
4. **The frozen baseline is net-new, not reuse.** Mis-attributed to `computeAnomalies` by every monitoring vision. **Mitigation: budget the `watchBaselines` table + re-snapshot policy as new infra in Phase 2** (with the free write-on-create slice pulled into Phase 1).
5. **Vector index can't range-filter (bbox) or filter by arbitrary articleId set.** Drawn polygons degrade to ISO granularity; diff-RAG needs a lexical/ID fetch path. **Mitigation: ship ISO/event-id scope (exact) first; flag arbitrary geometry as best-effort. The lexical/ID fetch path ships *with* the Phase 2 diff engine, not after it — the Change Report depends on it.**
6. **Per-watch eval cost at scale.** O(watches × scan) every 15 min, and cross-watch correlation is O(watches²). Fine on a homelab; needs incremental/dirty-region eval before scaling.

**Key decisions the founder must make**
- **Q1. Free/Pro line on Watches.** Recommendation: watch *creation* + in-app NEW markers Free; *Baseline Diff Reports* + email digests Pro. Does free-tier watch creation give away too much, or is it the hook that sells persistence? (Blueprint bets: it's the hook — and it's the cheapest possible proof of "it kept watching," which is why it's pulled into Phase 1.)
- **Q2. How aggressively to collapse analytical pages.** Power analysts may resent losing dedicated Trends/Entities dashboards behind conversational asks (flagged by 2 critiques). Recommendation: collapse to card-types but keep a deterministic `parseQuery` fast-path so "show me trends in the Sahel" never has to hit the slow 3B RAG path to render a dashboard-grade view. **Strategic dimension (beyond analyst preference): deterministic Trends/Entities views ARE the "computed, not narrated" moat — collapsing them *entirely* behind chat risks making Mapr present as a chat wrapper and hides its most defensible surface. The recommendation stands, but the computed dashboard view must remain directly reachable, not only summonable by prose, precisely because deterministic computation over an owned corpus is uncloneable while a chat answer is not.**
- **Q3. Map draw library now or later.** Lasso/draw is load-bearing for the most ambitious gestures but is net-new (no draw lib today). Recommendation: defer to Phase 3; ship click/ISO/viewport scope in Phase 1 (it covers most real queries). *(Pure build-sequencing call — web-search reality has no bearing here.)*
- **Q4. Entity canonicalization.** The Dossier and entity-watches are materially weaker without it ("Putin" ≠ "Vladimir Putin"). Is it worth the NLP investment, or do we ship raw-NER entity chips and accept the limitation? Recommendation: ship raw-NER, revisit canonicalization once corpus age makes the payoff compound. *(Pure buildability call — web-search reality has no bearing here.)*
- **Q5. Investigation vs. Monitoring as the headline.** This blueprint fuses both (investigation = the act, watches = the persistence). **Post-web-search, "investigate now" is the commoditized half (live cited search is free) and even "keeps watching" is half-commoditized (native scheduled tasks now exist). So lead with the one structurally uncloneable thing — the frozen-baseline diff:** *"Mapr watches your regions and tells you what **changed** — with frozen, defensible receipts."* Investigation is the on-ramp (free, proves the corpus is real); the change-since-baseline diff over an owned corpus is the hero, because it is the one thing a search-LLM — even one with scheduled tasks — structurally cannot do. This aligns the headline with §1's own 5-second wedge ("watches the world when you don't — and remembers what changed").
- **Q6. ICP targeting (the decision §1 makes binding).** Target monitoring/analyst users — risk/security teams, OSINT analysts, NGOs, journalists building durable cases, and anyone who needs self-hosting — **not** casual current-events users. Casual "what's happening in X today" demand is now fully and freely served by ChatGPT/Perplexity/Gemini; pursuing it is the wrapper trap. Evaluate every feature and onboarding choice against the analyst.

---

*File references: `convex/rag.ts`, `convex/lib/qa`, `convex/lib/sourceConfidence`, `convex/lib/intent` (`parseQuery`, `computeAnomalies`, `computeRegions`), `convex/crons.ts`, `convex/digests.ts`, `convex/exports.ts`, `convex/schema.ts` (`events`, `articles`, `cases`/`caseItems`, `savedViews`, `alertRules`, `watchlistItems`, `qaConversations`/`qaMessages`, `briefs`; **net-new `watchBaselines`**), ingestor `correlate.rs`/`recomputeEvent`, `entities.graph`/`entities.dossier`, frontend `MapPage`, `MaprMap`, `Composer.jsx`/`useComposerController`, `mapContext.js` (`deriveMapReaction`, to be deleted), `ChatMessage`, `EvidenceEventRow`, `CitationTray`, `FacetSummary`, `EventSheet`, `AnomalyRows`. PRODUCT.md lines 18 & 26.*