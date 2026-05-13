# AI Q&A Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (batch execution with checkpoints). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the right-side AI agent sidebar (RAG over Mapr's news corpus) per `docs/superpowers/specs/2026-05-13-ai-qa-sidebar-design.md`.

**Architecture:** A new `/api/qa/*` route family on the existing Node server; `server/qa/retrieve.js` runs top-k cosine retrieval against the `articles.embedding` column, `server/qa/conversations.js` persists chat threads in InstantDB via the admin SDK, and `server/ai/client.generate()` (already wired to the home-PC ai-worker) does generation with a strict JSON schema. The drawer is a React component mounted at app root, toggled from the Header and via Cmd/Ctrl+K.

**Tech Stack:** Node http + pg + InstantDB admin SDK + bullmq (optional, only for title-generation jobs); React + Zustand + react-i18next; pgvector cosine via the existing HNSW index.

---

## Task 1: InstantDB schema + perms

**Files:**
- Modify: `instant.schema.ts` — add `qaConversations`, `qaMessages` entities + `userQaConversations` link
- Modify: `instant.perms.ts` — add `qaConversations` (owner-only) and `qaMessages` (server-only) blocks

- [ ] Add entities + link to `instant.schema.ts`
- [ ] Add perms blocks to `instant.perms.ts`
- [ ] Commit

## Task 2: Top-K retrieval

**Files:**
- Create: `server/qa/retrieve.js` — `retrieveTopK(question, opts)` using pgvector cosine
- Test: `test/qaRetrieve.test.js` — smoke test that the SQL builds correctly and filters apply

- [ ] Write `retrieveTopK` that embeds the question via `aiClient.embed`, runs `SELECT … FROM articles ORDER BY embedding <=> $1 LIMIT $k` with optional time-window + region filters, drops rows below similarity threshold, returns enriched `{articleId, eventId, title, source, url, excerpt, similarity}` rows.
- [ ] Test: build a fake article row with a known vector, assert the SQL handles vector literals + filters.
- [ ] Commit

## Task 3: Conversation persistence

**Files:**
- Create: `server/qa/conversations.js` — InstantDB admin SDK CRUD
- Re-use: `server/auth.js` `getInstantDb()`

- [ ] Write `createConversation`, `listConversations`, `appendMessage`, `readMessages`, `archiveConversation`, `userMessageCountInLastDays`.
- [ ] Commit

## Task 4: QA JSON schema + generation prompt

**Files:**
- Create: `server/ai/schemas/qa.schema.json`
- Create: `server/qa/generate.js` — builds the prompt + calls `aiClient.generate`, validates output, enriches citations

- [ ] Write the JSON schema exactly as in the spec.
- [ ] Write `generateAnswer({ question, retrieved, priorMessages })` that returns `{ answer, citations: enriched[] }`.
- [ ] Commit

## Task 5: API routes

**Files:**
- Modify: `server/index.js` — wire `/api/qa/conversations*` and `/api/qa/conversations/:id/messages*`

- [ ] GET `/api/qa/conversations` — list
- [ ] POST `/api/qa/conversations` — create (returns id + default title)
- [ ] DELETE `/api/qa/conversations/:id` — archive
- [ ] GET `/api/qa/conversations/:id/messages` — list messages
- [ ] POST `/api/qa/conversations/:id/messages` — central handler: quota check → persist user msg → retrieve → generate → persist assistant msg → return
- [ ] Commit

## Task 6: Tier gating

**Files:**
- Modify: `src/utils/featureAccess.js` — add `aiQa` entry (free tier with quota; pro lifts cap)
- Modify: `src/pages/BillingPage.jsx` — mention "AI Agent" in tier copy if helpful
- Modify: `src/i18n/locales/en.json` — `agent.*` keys including quota strings

- [ ] Add aiQa to FEATURE_ACCESS_CATALOG.
- [ ] Add i18n strings: title, placeholders, errors, quota, cite tooltip, empty state, signed-out state.
- [ ] Commit

## Task 7: Client service layer

**Files:**
- Modify: `src/services/backendService.js` — add `listQaConversations`, `createQaConversation`, `fetchQaMessages`, `sendQaMessage`, `archiveQaConversation`

- [ ] Append the five methods following the existing `auth: true` pattern.
- [ ] Commit

## Task 8: useAgent hook

**Files:**
- Create: `src/hooks/useAgent.js`

- [ ] Manages: conversation list, active conversation id, message list per conversation, in-flight state, error, quota state.
- [ ] Optimistic append on user-message send.
- [ ] On 429: surface quota-exceeded state.
- [ ] Commit

## Task 9: UI primitives

**Files:**
- Create: `src/components/agent/AgentSidebarHeader.jsx`
- Create: `src/components/agent/AgentMessageList.jsx`
- Create: `src/components/agent/AgentComposer.jsx`
- Create: `src/components/agent/AgentCitation.jsx`

- [ ] Header: title + history menu + new chat button + close.
- [ ] MessageList: renders messages, markdown for assistant, citation pills.
- [ ] Composer: textarea, send button, "Use current page filters" toggle (sticky per conversation), quota inline notice.
- [ ] Citation: renders the superscript pill that routes via Link to `/event/:eventId` when present, else opens external URL.
- [ ] Commit

## Task 10: AgentSidebar root

**Files:**
- Create: `src/components/AgentSidebar.jsx` — drawer container
- Modify: `src/stores/uiStore.ts` — `agentSidebarOpen`, `setAgentSidebarOpen`
- Modify: `src/components/Layout.jsx` — mount drawer once at root
- Modify: `src/components/Header.jsx` — add toggle button
- Modify: `src/hooks/useKeyboardNavigation.js` — bind Cmd/Ctrl+K
- Modify: `src/index.css` — drawer styles + sub-component styles

- [ ] Drawer slides from right at 420 px (full-width on mobile).
- [ ] Closes on Esc, backdrop click on mobile only.
- [ ] Renders sign-in prompt when unauthenticated.
- [ ] Commit

## Task 11: Verify + commit + PR

- [ ] `npm test` — ensure no regressions in unrelated suites.
- [ ] `npm run build` — clean.
- [ ] Push branch + open PR.

---

## Self-review

Spec coverage: every section of `2026-05-13-ai-qa-sidebar-design.md` maps to one of the 11 tasks above. The "Open questions" section's locked decisions (global scope + per-conversation filter toggle, no shared cache) live in Task 9 (composer toggle) and Task 5 (no cache wired). The schema, perms, routes, generation prompt, citation enrichment, quota check, error handling, a11y, and i18n are all covered. The InstantDB perms model — server-only writes for `qaMessages` — is in Task 1 and enforced operationally by Task 5 because clients never see a write path.

Out of scope per spec: streaming SSE, sharing, multimodal — none of those land here.
