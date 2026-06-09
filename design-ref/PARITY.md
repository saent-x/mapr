# MAPR rearchitecture — parity checklist (grounded in legacy `server/index.js` routes + `instant.schema.ts`)

Status legend: **P1** = lean core (this build) · **P2** = parity (deferred) · **DROP** = removed (see plan §REDUNDANCY).

## Data surfaces (events / feed / map)
| Legacy | Disposition | New home |
| --- | --- | --- |
| `GET /api/events` | **P1** | Convex `events.list` reactive `useQuery` (drives markers) |
| `GET /api/briefing` | **P1** | Convex `articles.feed` / folded into `events.list` |
| `GET /api/stream` (SSE) | **DROP** | Convex reactivity (no polling) |
| `GET /api/coverage-history`, `/api/coverage-region` | **P2** | `coverage.*` queries |
| `GET /api/region-briefing` | **P2** | `/region/:iso` page |
| `GET /api/flights`, `/api/vessels` | **P2** | Rust SSE/WS (not persisted) |
| `GET /api/snapshot-history*` | **P2** | `snapshots.*` (Pro) |
| `GET /api/gdelt-proxy` | **DROP** | CORS proxy removed |

## AI / RAG / QA
| Legacy | Disposition | New home |
| --- | --- | --- |
| `GET/POST /api/qa/conversations` (+messages) | **P1** | `qa.*` queries/mutations + `rag.retrieve`/`rag.generate` actions |
| `server/qa/retrieve.js` (semantic+lexical merge) | **P1 (re-homed)** | `convex/rag.ts` vectorSearch + full-text hybrid |
| `server/qa/generate.js` (citation enforcement) | **P1 (re-homed)** | `convex/rag.ts` generate action (`[n]` enforced) |
| Python `/embed` (bge-m3) | **P1 (ported)** | Rust ingestor `/embed` (ort) |
| Python `/ner` (GLiNER) | **P1 (ported)** | Rust gazetteer/NER |
| `POST /api/events/:id/brief`, `/api/arcs`, narrative arcs, `/credibility` | **P2** | AI intel pack |
| `/api/me/beat*` (`user_beat_profiles` never created) | **DROP** | — |
| `/api/threads` (story threads) | **P2** | — |

## Auth / billing
| Legacy | Disposition | New home |
| --- | --- | --- |
| `GET /api/me` | **P1** | Convex `users.me` query (authed) |
| InstantDB magic-link | **P1** | Convex Auth magic-link |
| `POST /api/stripe/create-checkout-session` | **P1** | `billing.createCheckout` action |
| `POST /api/stripe/create-portal-session` | **P1** | `billing.createPortal` action |
| `POST /api/stripe/webhook` (raw-body, idempotent) | **P1** | `http.ts` `httpAction` (raw-body sig, `stripeEvents` idempotency) |
| Admin session/cookie auth (`/api/admin/session` …) | **P1** | Admin gated by authed user `role=admin` |

## Watchlist / alerts / saved views / bookmarks
| Legacy (InstantDB entities) | Disposition | New home |
| --- | --- | --- |
| `watchlistItems` | **P1** | `watchlist.*` |
| `alertRules` (+ digest schedule) | **P1** | `alerts.*` + cron digest sweep |
| `savedViews` (+ share token) | **P1** (share = P2) | `savedViews.*` |
| `bookmarks` | **P1** | `bookmarks.*` |
| `qaConversations`/`qaMessages` | **P1** | `qa.*` |
| `subscriptions`/`$users.subscriptionStatus` | **P1** | `users` fields |
| `profiles` | **P1** | folded into Convex `users` |

## Admin
| Legacy | Disposition | New home |
| --- | --- | --- |
| `GET/PUT /api/admin/feature-flags` | **P1** | `admin.featureFlags*` (authed admin) |
| `GET/POST/PUT/DELETE /api/source-catalog*` (add/import/re-enable/export/state) | **P1** | `admin.sourceCatalog*` |
| `POST /api/refresh` (trigger ingest) | **P1** | `controlSignals.refreshRequested` (Rust polls) |
| `GET /api/admin-health`, `db-size`, `db-trim` | **P1** (db ops via Convex export) | `admin.health`, prune cron |
| `POST /api/admin/alerts/digest-sweep`, `daily-digest` | **P1** | cron + `admin.runDigest` |
| `POST /api/admin/arcs/refresh` | **P2** | — |

## Frontend routes (design bundle)
| Route | Disposition |
| --- | --- |
| `/` lean map + composer | **P1** |
| `/account` (auth/billing) | **P1** |
| `/admin` minimal | **P1** |
| `/region/:iso` | **P2** |
| `/entities` (force graph) | **P2** |
| `/trends` (SVG charts) | **P2** |

## Dropped dependencies / dead code
`maplibre-gl`, cartoCDN tiles, `MapGLOverlay`, `corsproxy`/`allorigins`, `compromise`, `afinn-165`, `html2canvas`, `jspdf` (P2 export), client `eventCache` IndexedDB, `backendService` polling, Zustand server-cache, `server/qa/{retrieve,generate}.js` (re-homed), `urlGuard.assertPublicHost` (re-homed to Rust), `sourceCandidates.js`, Python sidecar (`home-pc/app`).
