# Mapr AI Q&A sidebar — design spec

**Date:** 2026-05-13
**Scope:** Workstream D1 in [Mapr Pro upgrade master plan](file:///Users/tor/.claude/plans/all-i-also-want-twinkly-parrot.md).
**Status:** Awaiting user approval.

## Context

Mapr's `articles.embedding` column already holds 3624 bge-m3 vectors (one
per article in the corpus) thanks to the Day-5 embedding backfill that
ran during the Coolify migration. The AI worker on the home lab serves
`/generate` over the same internal hostname Mapr's server already calls
for the existing Brief Generator. Every primitive needed for retrieval-
augmented generation is already in production.

The biggest user-visible win we can ship on top of those primitives is a
**conversational interface over the news corpus**: an analyst opens a
sidebar, types "What do we know about the suspect in the Stockholm
attack?", and gets a written answer with inline citations that link back
to the events Mapr already tracks.

No aggregator in this price tier offers this. Dataminr and Recorded
Future have something like it at enterprise pricing. Mapr can ship it on
the same infra it already runs.

The UX anchor is Railway's right-side **Agent** panel: a slide-in drawer
that lists a conversation thread with structured agent responses and a
textarea at the bottom. We replicate that layout, scoped to Mapr.

## Goals

1. **Right-side sidebar drawer**, globally available on every authenticated
   page. Toggleable from a header button (`💬 Agent` style) and via
   `Cmd/Ctrl+K`.
2. **Conversational thread** with persisted history per user across
   devices (multiple conversations per user, lazy-loaded on open).
3. **Citations are first-class** — every agent answer renders inline
   numbered superscripts that link to the matching event/article in
   Mapr. No uncited claims allowed by the system prompt.
4. **Free tier teaser**: 10 messages / 30 days. **Pro**: 200 messages /
   30 days. Hard cap surfaces an upgrade prompt.
5. **Graceful degradation** when the AI worker is unhealthy — fall back
   to Cloudflare Workers AI through the existing
   `server/ai/client.generate()` adapter; if both are down, show "AI
   service is offline, try again in a few minutes" rather than a stack
   trace.
6. **Non-goals** — streaming responses (v2), multimodal (images), code
   execution / tool use, voice. Pure text RAG over the indexed corpus.

## Architecture

```
[Sidebar drawer (React)]
        │
        │  POST /api/qa/conversations/:id/messages
        ▼
[Mapr Node server]
   ├─ qa/conversations.js  ← InstantDB-backed chat persistence
   ├─ qa/retrieve.js       ← top-k cosine retrieval over articles.embedding
   └─ ai/client.js         ← existing adapter, home-PC + Workers AI fallback
        │
        ▼
[Postgres (Coolify): articles.embedding via HNSW]
[InstantDB: qaConversations, qaMessages — per-user persistence]
[AI worker (Coolify mapr-ai-home-pc): /embed, /generate]
```

## Components

### Server: `server/qa/retrieve.js`

Single-responsibility module. Inputs: a question string + optional
filters (time window, region). Outputs: an ordered array of citation
candidates with `articleId`, `title`, `source`, `url`, `excerpt`, and
the similarity score.

```js
export async function retrieveTopK(question, {
  k = 8,
  timeWindowHours = 168,
  region = null,
  minSimilarity = 0.3,
} = {}) { ... }
```

Implementation:
1. Embed the question via `aiClient.embed({ inputs: [question] })`.
2. Run `SELECT id, title, source, url, payload, embedding <=> $1 AS dist
    FROM articles WHERE …filters… ORDER BY embedding <=> $1 LIMIT $k`.
   pgvector textual literal for the question vector.
3. Drop rows where `1 - dist < minSimilarity`.
4. Extract a short excerpt (~280 chars) from `payload.summary` or
   `title` for prompt context.

### Server: `server/qa/conversations.js`

Wraps InstantDB admin SDK for CRUD over `qaConversations` and `qaMessages`.

```js
export async function createConversation({ userId, title }) { ... }
export async function listConversations(userId, { archived = false }) { ... }
export async function appendMessage(conversationId, { role, content,
  citations, modelUsed, tokensIn, tokensOut }) { ... }
export async function readMessages(conversationId, { limit = 40 }) { ... }
export async function archiveConversation(conversationId, userId) { ... }
export async function userMessageCountInLastDays(userId, days = 30) { ... }
```

The count helper enforces tier quotas.

### Server: routes in `server/index.js`

All require `requireUser`.

```
GET    /api/qa/conversations                  → { conversations: [...] }
POST   /api/qa/conversations                  → { conversation }
DELETE /api/qa/conversations/:id              → 204
GET    /api/qa/conversations/:id/messages     → { messages: [...] }
POST   /api/qa/conversations/:id/messages     → { message }     # main entry
```

The POST messages handler is the central piece. It:
1. Verifies conversation ownership.
2. Enforces tier quota — free ≤10, Pro ≤200 in trailing 30 days; on
   exceed, returns `429 { error, code: 'QUOTA_EXCEEDED' }`.
3. Persists the user message.
4. Calls `retrieveTopK` with the user's last 2 messages joined as the
   query (gives context for follow-ups).
5. Calls `aiClient.generate({ task: 'qa', input, schema: QA_SCHEMA })`.
6. Persists the assistant message with the cited articles.
7. If the conversation has no title yet (first user message), enqueues a
   background `generate-title` call and patches the conversation later.

### Server: JSON schema `server/ai/schemas/qa.schema.json`

```json
{
  "type": "object",
  "required": ["answer", "citations"],
  "additionalProperties": false,
  "properties": {
    "answer": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000,
      "description": "Markdown answer. Use [1], [2]… inline markers
                      matching the citations array. NEVER invent facts
                      beyond the provided sources. If sources are
                      insufficient, say so explicitly."
    },
    "citations": {
      "type": "array",
      "maxItems": 8,
      "items": {
        "type": "object",
        "required": ["index", "articleId"],
        "properties": {
          "index":     { "type": "integer", "minimum": 1, "maximum": 12 },
          "articleId": { "type": "string" },
          "quote":     { "type": "string", "maxLength": 240 }
        }
      }
    }
  }
}
```

After the LLM returns, the server **enriches** each citation by looking
up the article row + its parent event (if any) and produces the final
client-facing payload:

```json
{
  "index": 1,
  "articleId": "...",
  "eventId": "...",       // null if the article has no parent event
  "title":   "...",
  "source":  "...",
  "url":     "https://..."
}
```

This is what gets persisted in `qaMessages.citations` and rendered by
`<AgentCitation />`.

### Client: `src/components/AgentSidebar.jsx`

Right-side drawer. Three sub-components:

- `<AgentSidebarHeader />` — conversation title (click to rename),
  history menu (recent 10 conversations + "New chat"), close X.
- `<AgentMessageList />` — scrolling message list. User bubbles
  right-aligned; assistant bubbles left, with rendered markdown +
  superscript citation pills (`<sup>[1]</sup>`). Each pill resolves to
  a Mapr URL as follows: if the cited article is linked to an event in
  `event_articles`, the pill navigates to `/event/:eventId`; otherwise
  it opens the article's external URL in a new tab. The server
  pre-resolves this in the `citations` payload so the client doesn't
  do its own join.
- `<AgentComposer />` — textarea + send button. Cmd/Ctrl+Enter sends;
  Esc closes the drawer.

The drawer is rendered once at the root inside `Layout.jsx` and
toggled via a new `useUIStore` field `agentSidebarOpen`. A header
button in `Header.jsx` toggles it; `Cmd/Ctrl+K` is the keyboard
binding (added to `useKeyboardNavigation`).

State management uses an `useAgent` hook (new) that wraps the
backend service calls and an in-memory cache keyed on conversation id.

### Client: `src/services/backendService.js` additions

```js
export function listQaConversations() { ... }
export function createQaConversation({ title }) { ... }
export function fetchQaMessages(conversationId) { ... }
export function sendQaMessage(conversationId, content) { ... }
export function archiveQaConversation(conversationId) { ... }
```

### InstantDB schema additions

```ts
qaConversations: i.entity({
  title:       i.string(),
  createdAt:   i.number(),
  updatedAt:   i.number(),
  archived:    i.boolean().optional(),
  lastMessageAt: i.number().optional(),
  messageCount:  i.number().optional(),
}),

qaMessages: i.entity({
  conversationId: i.string().indexed(),
  role:           i.string(),            // 'user' | 'assistant'
  content:        i.string(),
  citations:      i.json().optional(),   // assistant rows only
  modelUsed:      i.string().optional(),
  tokensIn:       i.number().optional(),
  tokensOut:      i.number().optional(),
  createdAt:      i.number(),
}),
```

Links:
```ts
userQaConversations: {
  forward: { on: 'qaConversations', has: 'one',  label: 'owner' },
  reverse: { on: '$users',         has: 'many', label: 'qaConversations' },
},
```

Messages are not linked via Instant — `conversationId` is enforced on
the server side and used for queries. This keeps the link graph small
and avoids the n-way link explosion that bites for chat-style data.

### Perms

```ts
qaConversations: {
  bind:  { isOwner: "data.id in auth.ref('$user.qaConversations.id')" },
  allow: { view: 'isOwner', create: "auth.id in data.ref('owner.id')",
           update: 'isOwner', delete: 'isOwner' },
},
qaMessages: {
  // Messages are server-owned; clients never write them directly.
  allow: { view: false, create: false, update: false, delete: false },
},
```

Clients read messages exclusively through `GET /api/qa/conversations/:id/messages`,
which authorizes via `requireUser` and confirms conversation ownership
in Postgres-server-side logic before returning rows.

## Data flow — message send

```
User types question and presses Enter
   │
   ▼
useAgent.sendMessage()
   │   ─ optimistically appends user message in client cache
   │
   ▼
POST /api/qa/conversations/:id/messages
   │
   ├─ requireUser → user.id
   ├─ Verify conversation owned by user.id (InstantDB query)
   ├─ Quota check: userMessageCountInLastDays(user.id, 30)
   │   ─ if > tier_limit → 429 QUOTA_EXCEEDED
   ├─ appendMessage(role='user')
   ├─ retrieveTopK(question + last assistant turn for context)
   ├─ aiClient.generate({ task:'qa', input:{question, citations:retrieved,
   │                       prior_messages:last 6}, schema:QA_SCHEMA })
   ├─ Validate output against schema (server-side)
   ├─ Map citations[].articleId → resolve to {title, source, url}
   ├─ appendMessage(role='assistant', citations:resolved)
   └─ If conversation.title is still 'New conversation' and this is the
      first user message, enqueue title-generation job (background)
   │
   ▼
{ message: { id, role, content, citations, ... } }
   │
   ▼
Client replaces optimistic message with server-returned one
```

## Error handling

| Condition                                | Response                                  | UX                                                       |
| ---                                      | ---                                       | ---                                                      |
| User unauthenticated                     | 401                                       | Drawer renders sign-in prompt instead of composer        |
| Quota exceeded                           | 429 + `QUOTA_EXCEEDED`                    | Inline upgrade prompt above composer; composer disabled  |
| Conversation not owned by user           | 403                                       | Drawer closes, toast: "Conversation not found"           |
| AI worker + Workers AI both down         | 503                                       | Inline error bubble: "AI service offline — try again"    |
| Retrieval returns 0 articles ≥ threshold | 200 with `citations:[]`                   | Assistant: "I couldn't find recent coverage on that…"    |
| Output schema validation fails           | 502                                       | Inline error bubble: "Got an invalid response — retried" |
| Network timeout (45 s)                   | 504 client-side                           | "Request timed out — please retry"                       |

## Quota enforcement

Free: 10 user-messages / trailing 30 days.
Pro:  200 user-messages / trailing 30 days.

Counter computed via InstantDB query:
```ts
db.queryOnce({
  qaMessages: {
    $: { where: { role: 'user', createdAt: { $gte: cutoff },
                  'conversation.owner.id': userId } }
  }
})
```

If `userMessageCountInLastDays` is hot on the request path, denormalize
to a `qaMessagesUsedThisMonth` field on `$users` updated on each send.
First implementation uses the live query; switch to denormalized if
p99 exceeds 100 ms.

Quota check happens **before** the LLM call so we don't spend tokens
on rejected requests.

## Tier reshape impact

Add `aiQa` feature to `src/utils/featureAccess.js`:

```js
{
  id: 'aiQa',
  label: 'AI Q&A',
  description: 'Conversational search over the news corpus with citations.',
  category: 'Analysis',
  defaultTier: FEATURE_TIER_FREE,   // free with quota; Pro lifts the cap
},
```

Update Billing tier copy to mention quotas.

## UI / accessibility

- Drawer width: 420 px desktop, full-width mobile.
- Backdrop click closes; Esc closes; Cmd/Ctrl+K toggles.
- `aria-label="AI Agent"`, `role="dialog"`, `aria-modal="true"` when
  open (mobile only — on desktop it's `aria-modal="false"` because the
  rest of the page stays interactive).
- All conversation rows in the history menu announce
  `aria-current="page"` when active.
- Reduced motion: drawer slides without animation when
  `prefers-reduced-motion: reduce`.
- The composer textarea grows to a max of 6 lines, then scrolls
  internally.

## Testing

Unit:
- `retrieveTopK` returns ordered rows, drops below-threshold, respects
  the time window.
- `appendMessage` rejects bad roles + obviously malformed citations.
- Quota helper counts exactly the user's messages in the window.

Integration (uses `MAPR_AI_HOMEPC_*` envs or mocks):
- POST a message → response cites at least one retrieved article whose
  id matches a row in `articles`.
- Quota check: synthetic 11th message in same 30 days returns 429.
- Conversation history: subsequent GET returns the persisted thread.

E2E manual on `mapr.tors-x.dev`:
- Open Cmd/Ctrl+K → drawer slides in.
- Type "What happened in Yemen this week?" → answer + citations render.
- Click citation [1] → navigates to the correct event.
- Refresh page, reopen drawer → conversation restored.
- Sign out → drawer shows sign-in prompt.
- Mobile (DevTools 375 px): drawer full-screen, composer reachable
  with on-screen keyboard.

## File / module layout

### New
- `src/components/AgentSidebar.jsx`
- `src/components/agent/AgentSidebarHeader.jsx`
- `src/components/agent/AgentMessageList.jsx`
- `src/components/agent/AgentComposer.jsx`
- `src/components/agent/AgentCitation.jsx`
- `src/hooks/useAgent.js`
- `src/services/qa.js` (or extend `backendService.js`)
- `server/qa/retrieve.js`
- `server/qa/conversations.js`
- `server/ai/schemas/qa.schema.json`

### Modified
- `src/components/Layout.jsx` — mount the drawer at app root.
- `src/components/Header.jsx` — add Agent toggle button.
- `src/hooks/useKeyboardNavigation.js` — bind Cmd/Ctrl+K.
- `src/stores/uiStore.ts` — `agentSidebarOpen`, `activeQaConversationId`.
- `src/utils/featureAccess.js` — add `aiQa` feature row.
- `server/index.js` — register new `/api/qa/*` routes.
- `instant.schema.ts` — add entities + link.
- `instant.perms.ts` — add perm blocks.
- `src/index.css` — drawer styles.
- `src/i18n/locales/en.json` — `agent.*` keys.

## Out of scope (deferred to D1.v2)

- Streaming token-by-token responses (uses Server-Sent Events; the
  payoff is real but doubles the server complexity for v1).
- Sharing a conversation via a read-only link.
- Sending images/PDF to the agent.
- Voice input.
- Multi-language agent UI strings beyond English (other locales fall
  back to English keys).

## Open questions for the reviewer

1. Should the agent be **scoped to the current page's filter context**
   (e.g. on `/region/UA` it only retrieves Ukraine articles) or always
   **global**? Default in spec: global, with an optional "Use current
   filters" toggle in the composer.
2. Should we **cache identical questions** at the server level so two
   users asking the same thing in the same hour reuse one LLM call?
   Default in spec: no — privacy / quota fairness argues against
   shared cache.

Reviewer can answer either question or accept the defaults.
