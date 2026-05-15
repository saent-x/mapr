import http from 'node:http';
import crypto from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');
const HAS_DIST = existsSync(DIST_DIR);

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.gif': 'image/gif',
};

function serveStaticFile(response, filePath) {
  const ext = extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const stat = statSync(filePath);
  response.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(response);
}
import { buildAdminHealthPayload, mergeAdminHealthPayloads } from '../src/utils/healthSummary.js';
import { DEFAULT_FEATURE_FLAGS, normalizeFeatureFlags } from '../src/utils/featureAccess.js';
import {
  closeStorage,
  enforceDbSizeLimit,
  getDbSize,
  getDbSizeLimits,
  getDroppedArticleLinkCount,
  getTableSizes,
  readMetadataJson,
  readSnapshotHistory,
  readSnapshotTimestamps,
  readSourceCredibilityScores,
  writeMetadataJson
} from './storage.js';
import {
  getBriefing,
  getCoverageHistory,
  getRegionBriefing,
  getRegionCoverageHistory,
  getHealth,
  getSourceCatalogStatus,
  initializeIngestion,
  refreshSnapshot,
  startScheduler,
  stopScheduler
} from './ingest.js';
import {
  readSourceCatalog,
  writeSourceCatalog,
  readSourceState,
  hydrateSourceCatalog,
  summarizeSourceCatalog,
  addSourceToCatalog,
  updateSourceInCatalog,
  removeSourceFromCatalog,
  importSourcesToCatalog,
  reEnableSourceInCatalog,
  autoDisableFailingSources
} from './sourceCatalog.js';
import { getSourceCatalogStorageInfo } from './sourceCatalogStore.js';
import { getCircuitSummary } from './circuitBreaker.js';
import {
  addClient as addSseClient,
  removeClient as removeSseClient,
  broadcast as sseBroadcast,
  clientCount as sseClientCount,
  canAcceptClient as canAcceptSseClient
} from './sse.js';
import { getCachedAircraft, startFlightTracking, stopFlightTracking, getLastPollTime } from './flightTracker.js';
import { getCachedVessels, startShipTracking, stopShipTracking, startBatchPush } from './shipTracker.js';
import {
  buildClearSessionCookie,
  buildSetSessionCookie,
  canIssueAdminSession,
  createSessionToken,
  getSessionTokenFromCookie,
  verifySessionToken
} from './adminSession.js';
import { log } from './logger.js';
import { isPublicHttpUrl } from './urlGuard.js';
import { timingSafeEqualString } from './adminAuth.js';
import { createCheckoutSession, createPortalSession, handleStripeWebhook } from './stripe.js';
import { requireUser, getRequestUserRecord } from './auth.js';
import { listThreadsForUser, createThread, archiveThread } from './storyThreads.js';
import { runDigestSweep } from './alerts/dispatch.js';
import { runDailyDigestSweep } from './alerts/dailyDigest.js';
import { buildCredibilityForEvent } from './sourceCredibility.js';
import {
  readLatestContradictions,
  generateContradictionsForEvent,
} from './contradictions.js';
import { generateBrief, readLatestBrief } from './briefs.js';
import { readEventById } from './storage.js';
import {
  generateEntityDossier,
  readLatestDossier,
  normalizeEntityKey,
} from './entityDossiers.js';
import {
  readLatestReporterPrompt,
  generateReporterPromptForEvent,
  readLatestWhyNow,
  generateWhyNowForEvent,
} from './eventInsights.js';
import {
  runNarrativeArcSweep,
  listActiveArcs,
  readArc,
  readArcsForEvent,
} from './narrativeArcs.js';
import {
  createConversation as createQaConversation,
  listConversations as listQaConversations,
  getConversation as getQaConversation,
  appendMessage as appendQaMessage,
  readMessages as readQaMessages,
  archiveConversation as archiveQaConversation,
  setConversationUseFilters as setQaConversationUseFilters,
  userMessageCountInLastDays as qaUserMessageCount,
} from './qa/conversations.js';
import { qa as callAiGatewayQa } from './ai/gateway.js';
import {
  readBeatProfile,
  upsertBeatProfile,
  deleteBeatProfile,
} from './beats/profile.js';
import { matchBeatForUser } from './beats/match.js';

const GDELT_DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

const PORT = Number(process.env.PORT || process.env.MAPR_API_PORT || 3030);
const API_TIMEOUT_MS = 30_000; // 30s timeout for API request handlers
const FEATURE_FLAGS_METADATA_KEY = 'feature_flags';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
  'access-control-allow-headers': 'Content-Type, X-Admin-Password, Authorization',
};

// Sent on every response. CSP belongs in index.html so it covers static
// assets too; here we add transport-layer hardening that the browser
// applies regardless of route.
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
};

const SENSITIVE_API_PREFIXES = [
  '/api/admin',
  '/api/admin-auth',
  '/api/admin-health',
  '/api/source-catalog',
  '/api/stripe',
  '/api/me',
  '/api/refresh',
];

function corsHeadersForPath(pathname) {
  if (!SENSITIVE_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return CORS_HEADERS;
  }
  return {
    'access-control-allow-methods': CORS_HEADERS['access-control-allow-methods'],
    'access-control-allow-headers': CORS_HEADERS['access-control-allow-headers'],
    vary: 'Origin',
  };
}

function sendJson(response, statusCode, payload, extraHeaders = {}, requestPath = '') {
  response.writeHead(statusCode, {
    ...corsHeadersForPath(requestPath || response._maprPath || ''),
    ...SECURITY_HEADERS,
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

/** @param {string[]} setCookieValues */
function sendJsonWithCookies(response, statusCode, payload, setCookieValues, requestPath = '') {
  response.statusCode = statusCode;
  for (const [k, v] of Object.entries({
    ...corsHeadersForPath(requestPath || response._maprPath || ''),
    ...SECURITY_HEADERS,
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8'
  })) {
    response.setHeader(k, v);
  }
  for (const c of setCookieValues) {
    response.appendHeader('Set-Cookie', c);
  }
  response.end(JSON.stringify(payload));
}

function isHttpsRequest(request) {
  const xfp = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return xfp === 'https';
}

function getAdminPassword() {
  return String(process.env.ADMIN_PASSWORD || '').trim();
}

function adminPasswordConfigured() {
  return Boolean(getAdminPassword());
}

function adminAuthorized(request) {
  const adminPw = getAdminPassword();
  if (!adminPw) return false;
  const header = String(request.headers['x-admin-password'] || '').trim();
  if (header === adminPw) return true;
  const tok = getSessionTokenFromCookie(request.headers.cookie);
  return Boolean(tok && verifySessionToken(tok));
}

async function readFeatureFlags() {
  const stored = await readMetadataJson(FEATURE_FLAGS_METADATA_KEY, DEFAULT_FEATURE_FLAGS);
  return normalizeFeatureFlags(stored);
}

async function writeFeatureFlags(payload) {
  const flags = normalizeFeatureFlags({
    ...payload,
    updatedAt: new Date().toISOString(),
  });
  await writeMetadataJson(FEATURE_FLAGS_METADATA_KEY, flags);
  return flags;
}

async function readJsonBody(request, maxBytes = 32_768) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      throw Object.assign(new Error('Request body too large'), { code: 'PAYLOAD_TOO_LARGE', statusCode: 413 });
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { code: 'BAD_REQUEST', statusCode: 400 });
  }
}

/** Read the raw request body as a UTF-8 string (for webhook signatures). */
async function readRawBody(request, maxBytes = 256_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      throw Object.assign(new Error('Request body too large'), { code: 'PAYLOAD_TOO_LARGE', statusCode: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    ...CORS_HEADERS,
    ...SECURITY_HEADERS,
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8'
  });
  response.end(text);
}

/**
 * Verify a paywall: requires an authenticated user whose subscription
 * grants access to `featureId` per the current feature flags.
 * Throws with statusCode 401 (no/invalid token) or 402 (auth ok but
 * subscription does not grant the feature).
 */
async function requireProFeature(request, featureId) {
  const { record } = await getRequestUserRecord(request);
  const flags = await readFeatureFlags();
  const status = record?.subscriptionStatus || 'free';
  const required = flags.features[featureId] || 'pro';
  if (flags.billingEnabled === false) return record;
  if (required === 'disabled') {
    throw Object.assign(new Error('Feature disabled'), { code: 'FEATURE_DISABLED', statusCode: 403 });
  }
  if (required === 'free') return record;
  if (status === 'pro' || status === 'enterprise') return record;
  throw Object.assign(new Error('Subscription required'), { code: 'PAYMENT_REQUIRED', statusCode: 402 });
}

/**
 * Wrap an async handler with a timeout. If the handler takes longer than
 * API_TIMEOUT_MS, the request is aborted with a 504 Gateway Timeout.
 */
function withTimeout(asyncFn, timeoutMs = API_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('Request timed out'), { code: 'REQUEST_TIMEOUT', statusCode: 504 }));
    }, timeoutMs);

    asyncFn()
      .then((result) => { clearTimeout(timer); resolve(result); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

/**
 * Classify an error into an HTTP status code and structured response.
 * Maps known error patterns to appropriate status codes.
 * Default 500 uses a generic message to avoid leaking internal details.
 */
function classifyError(error) {
  const message = error?.message || 'Internal server error';
  const code = error?.code || undefined;

  // Timeout errors → 504
  if (code === 'REQUEST_TIMEOUT' || error?.statusCode === 504) {
    return { status: 504, body: { error: 'Request timed out', code: 'REQUEST_TIMEOUT' } };
  }

  if (code === 'PAYLOAD_TOO_LARGE' || error?.statusCode === 413) {
    return { status: 413, body: { error: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' } };
  }

  if (code === 'UNAUTHORIZED' || error?.statusCode === 401) {
    return { status: 401, body: { error: message || 'Unauthorized', code: 'UNAUTHORIZED' } };
  }

  if (code === 'PAYMENT_REQUIRED' || error?.statusCode === 402) {
    return { status: 402, body: { error: 'Subscription required', code: 'PAYMENT_REQUIRED' } };
  }

  if (code === 'FEATURE_DISABLED' || code === 'NO_CUSTOMER' || error?.statusCode === 403 || error?.statusCode === 404) {
    return { status: error?.statusCode || 403, body: { error: message, code: code || 'FORBIDDEN' } };
  }

  if (code === 'AUTH_NOT_CONFIGURED' || error?.statusCode === 503) {
    return { status: 503, body: { error: 'Service unavailable', code: code || 'SERVICE_UNAVAILABLE' } };
  }

  if (code === 'BAD_REQUEST' && error?.statusCode === 400) {
    return { status: 400, body: { error: message, code: 'BAD_REQUEST' } };
  }

  // Bad request patterns (missing/invalid parameters) — safe to expose
  if (/^Missing\b/i.test(message) || /^Unknown region/i.test(message) || /^Invalid\b/i.test(message)) {
    return { status: 400, body: { error: message, code: 'BAD_REQUEST' } };
  }

  // Default → 500 with generic message (don't leak internal error details)
  return { status: 500, body: { error: 'Internal server error', code: code || 'INTERNAL_ERROR' } };
}

async function handleSourceCatalog(request, response, url) {
  if (request.method === 'GET') {
    const [catalog, sourceState] = await Promise.all([readSourceCatalog(), readSourceState()]);
    sendJson(response, 200, {
      storage: getSourceCatalogStorageInfo(),
      summary: summarizeSourceCatalog(catalog, sourceState),
      feeds: hydrateSourceCatalog(catalog, sourceState)
    });
    return;
  }

  if (request.method === 'POST') {
    if (!adminAuthorized(request)) {
      sendJson(response, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
      return;
    }
    let body;
    try {
      body = await readJsonBody(request, 256 * 1024);
    } catch (e) {
      const { status, body: b } = classifyError(e);
      sendJson(response, status, b);
      return;
    }
    if (!Array.isArray(body.feeds)) {
      sendJson(response, 400, { error: 'Missing feeds array', code: 'BAD_REQUEST' });
      return;
    }
    for (const feed of body.feeds) {
      if (!feed || typeof feed !== 'object' || !isPublicHttpUrl(feed.url)) {
        sendJson(response, 400, { error: 'Feed URL must be a public http(s) URL', code: 'BAD_REQUEST' });
        return;
      }
    }
    const catalog = await writeSourceCatalog(body.feeds);
    const sourceState = await readSourceState();
    sendJson(response, 200, {
      storage: getSourceCatalogStorageInfo(),
      summary: summarizeSourceCatalog(catalog, sourceState),
      feeds: hydrateSourceCatalog(catalog, sourceState)
    });
    return;
  }

  sendJson(response, 405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
}

async function handleGdeltProxy(request, response, url) {
  const query = url.searchParams.get('query');
  if (!query) {
    sendJson(response, 400, { error: 'Missing query parameter', code: 'BAD_REQUEST' });
    return;
  }

  let timespan = url.searchParams.get('timespan');
  if (!timespan || !/^\d+[mhd]$/.test(timespan)) timespan = '15min';

  let maxrecords = parseInt(url.searchParams.get('maxrecords'), 10);
  if (Number.isNaN(maxrecords) || maxrecords < 1) maxrecords = 250;
  else if (maxrecords > 500) maxrecords = 500;

  const params = new URLSearchParams({
    query,
    mode: 'artlist',
    format: 'json',
    timespan,
    maxrecords: String(maxrecords),
    sort: 'DateDesc',
  });

  try {
    const upstream = await fetch(`${GDELT_DOC_URL}?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok) {
      sendJson(response, 502, { error: `GDELT returned ${upstream.status}`, code: 'UPSTREAM_ERROR' });
      return;
    }
    const data = await upstream.json();
    sendJson(response, 200, data, { 'cache-control': 's-maxage=120, stale-while-revalidate=300' });
  } catch (err) {
    sendJson(response, 502, { error: 'GDELT proxy request failed', code: 'UPSTREAM_ERROR' });
  }
}

/** Build the admin-health response from the local server's cached briefing */
async function buildAdminHealthResponse() {
  const briefingPayload = buildAdminHealthPayload(await getBriefing(), {
    timestamp: new Date().toISOString()
  });
  const healthPayload = await getHealth();

  const merged = mergeAdminHealthPayloads(briefingPayload, {
    sourceHealth: healthPayload.sourceHealth,
    coverageMetrics: healthPayload.coverageMetrics,
    coverageDiagnostics: healthPayload.coverageDiagnostics
  });
  // Surface integrity counters separately so dropped links don't disappear
  // silently. Spike here means UI is missing sources for some events.
  merged.integrity = {
    droppedArticleLinks: getDroppedArticleLinkCount()
  };
  return merged;
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: 'Missing request URL' });
    return;
  }

  if (request.method === 'OPTIONS') {
    const optionsUrl = new URL(request.url, `http://127.0.0.1:${PORT}`);
    response.writeHead(204, corsHeadersForPath(optionsUrl.pathname));
    response.end();
    return;
  }

  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  response._maprPath = url.pathname;

  try {
    // ── Stateful routes (use server's cache/SQLite) ──

    // /api/briefing & /api/events: response is identical for all viewers, so
    // public 60s cache is safe. If per-user data is ever added, switch to `private`.
    if (request.method === 'GET' && url.pathname === '/api/briefing') {
      const briefing = await withTimeout(() => getBriefing());
      const hasSnapshot = briefing.meta.fetchedAt || briefing.articles.length > 0;
      const cacheHeaders = hasSnapshot
        ? { 'cache-control': 'public, max-age=60, stale-while-revalidate=120', vary: 'Origin, Accept-Encoding' }
        : {};
      sendJson(response, hasSnapshot ? 200 : 503, briefing, cacheHeaders);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/events') {
      const briefing = await withTimeout(() => getBriefing());
      const hasSnapshot = briefing.meta.fetchedAt || briefing.events.length > 0;
      const cacheHeaders = hasSnapshot
        ? { 'cache-control': 'public, max-age=60, stale-while-revalidate=120', vary: 'Origin, Accept-Encoding' }
        : {};
      sendJson(response, hasSnapshot ? 200 : 503, {
        meta: briefing.meta,
        events: briefing.events,
        sourceHealth: briefing.sourceHealth,
        ingestHealth: briefing.ingestHealth
      }, cacheHeaders);
      return;
    }

    // Liveness: process is up. Always 200 unless we're in the middle of
    // shutdown. Used by orchestrators (Railway, K8s) to decide whether to
    // restart the container.
    if (request.method === 'GET' && url.pathname === '/api/health/live') {
      sendJson(response, _shuttingDown ? 503 : 200, { ok: !_shuttingDown });
      return;
    }

    // Readiness: are we ready to serve traffic? Postgres reachable, snapshot
    // primed. Used by load balancers to decide whether to route requests.
    if (request.method === 'GET' && (url.pathname === '/api/health/ready' || url.pathname === '/api/health')) {
      const health = await withTimeout(() => getHealth());
      health.circuitBreaker = getCircuitSummary();
      let dbOk = false;
      try {
        const size = await getDbSize();
        const limits = getDbSizeLimits();
        health.database = {
          ...size,
          limitMb: limits.limitMb,
          hardMb: limits.hardMb,
          capacityMb: limits.capacityMb
        };
        dbOk = true;
      } catch (err) {
        // Surface the failure honestly — a healthy 200 here would route
        // traffic to a broken instance.
        health.database = { error: err.message };
      }
      const briefingReady = health.snapshotStatus !== 'cold';
      const ready = dbOk && briefingReady && !_shuttingDown;
      const subscriptionStatus = process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET
        ? 'configured'
        : 'disabled';
      sendJson(response, ready ? 200 : 503, { ...health, ready, subscription_status: subscriptionStatus });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/feature-flags') {
      sendJson(response, 200, await readFeatureFlags());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/feature-flags') {
      if (!adminAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      sendJson(response, 200, await readFeatureFlags());
      return;
    }

    if (request.method === 'PUT' && url.pathname === '/api/admin/feature-flags') {
      if (!adminAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      let body;
      try { body = await readJsonBody(request, 64_768); }
      catch (e) { const { status, body: b } = classifyError(e); sendJson(response, status, b); return; }
      sendJson(response, 200, await writeFeatureFlags(body));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/db-size') {
      if (!adminAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      const [size, tables] = await Promise.all([getDbSize(), getTableSizes()]);
      const limits = getDbSizeLimits();
      sendJson(response, 200, {
        ...size,
        capacityMb: limits.capacityMb,
        limitMb: limits.limitMb,
        targetMb: limits.targetMb,
        hardMb: limits.hardMb,
        tables
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/db-trim') {
      if (!adminAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      const result = await withTimeout(() => enforceDbSizeLimit(), 120_000);
      sendJson(response, 200, result);
      return;
    }

    // ── SSE: real-time event stream ──
    if (request.method === 'GET' && url.pathname === '/api/stream') {
      // Reject BEFORE writing the 200/preamble so a refused client sees a
      // real 503 instead of a misleading "200 then immediate disconnect".
      if (!canAcceptSseClient()) {
        sendJson(response, 503, { error: 'SSE pool at capacity', code: 'SSE_CAPACITY' });
        return;
      }
      try {
        request.socket?.setKeepAlive?.(true, 30_000);
        request.socket?.setNoDelay?.(true);
      } catch { /* best-effort */ }
      // Wire the close handler BEFORE adding to the pool so a TCP-RST race
      // can't leave a dead client in the broadcast set.
      request.on('close', () => removeSseClient(response));
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        ...CORS_HEADERS
      });
      response.write(': connected\n\n');
      const accepted = addSseClient(response);
      if (!accepted) {
        try { response.end(); } catch { /* ignore */ }
        return;
      }
      return;
    }

    // ── Flight tracking data ──
    if (request.method === 'GET' && url.pathname === '/api/flights') {
      sendJson(response, 200, { aircraft: getCachedAircraft(), lastPollTime: getLastPollTime(), fetchedAt: new Date().toISOString() });
      return;
    }

    // ── Ship tracking data ──
    if (request.method === 'GET' && url.pathname === '/api/vessels') {
      const enabled = !!process.env.AISSTREAM_API_KEY;
      sendJson(response, 200, {
        vessels: getCachedVessels(),
        enabled,
        fetchedAt: new Date().toISOString(),
      });
      return;
    }

    if ((request.method === 'GET' || request.method === 'POST') && url.pathname === '/api/source-catalog') {
      await withTimeout(() => handleSourceCatalog(request, response, url));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/source-reliability') {
      try {
        const scores = await readSourceCredibilityScores();
        sendJson(response, 200, scores);
      } catch (err) {
        console.error('[api] source-reliability error:', err.message);
        sendJson(response, 500, { error: 'Failed to read source reliability data' });
      }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/source-catalog/state') {
      sendJson(response, 200, getSourceCatalogStatus());
      return;
    }

    // ── Admin source management CRUD ──────────────────────────────────────────

    if (request.method === 'POST' && url.pathname === '/api/source-catalog/add') {
      if (!adminAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      let body;
      try { body = await readJsonBody(request, 64_768); }
      catch (e) { const { status, body: b } = classifyError(e); sendJson(response, status, b); return; }
      if (!body.name || !body.url) {
        sendJson(response, 400, { error: 'Missing required fields: name, url', code: 'BAD_REQUEST' });
        return;
      }
      try {
        const catalog = await readSourceCatalog();
        const updated = addSourceToCatalog(catalog, body);
        await writeSourceCatalog(updated);
        const sourceState = await readSourceState();
        const newEntry = updated[updated.length - 1];
        sendJson(response, 200, { ok: true, source: newEntry, summary: summarizeSourceCatalog(updated, sourceState) });
      } catch (err) {
        console.error('[api] source-catalog add error:', err.message);
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'PUT' && url.pathname.startsWith('/api/source-catalog/') && !url.pathname.endsWith('/add') && !url.pathname.endsWith('/import') && !url.pathname.endsWith('/re-enable') && !url.pathname.endsWith('/state')) {
      if (!adminAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      const id = url.pathname.replace('/api/source-catalog/', '');
      if (!id) {
        sendJson(response, 400, { error: 'Missing source ID', code: 'BAD_REQUEST' });
        return;
      }
      let body;
      try { body = await readJsonBody(request, 64_768); }
      catch (e) { const { status, body: b } = classifyError(e); sendJson(response, status, b); return; }
      try {
        const catalog = await readSourceCatalog();
        if (!catalog.some((e) => e.id === id)) {
          sendJson(response, 404, { error: 'Source not found', code: 'NOT_FOUND' });
          return;
        }
        const updated = updateSourceInCatalog(catalog, id, body);
        await writeSourceCatalog(updated);
        const sourceState = await readSourceState();
        const updatedEntry = updated.find((e) => e.id === id);
        sendJson(response, 200, { ok: true, source: updatedEntry, summary: summarizeSourceCatalog(updated, sourceState) });
      } catch (err) {
        console.error('[api] source-catalog edit error:', err.message);
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/api/source-catalog/') && !url.pathname.endsWith('/add') && !url.pathname.endsWith('/import') && !url.pathname.endsWith('/re-enable') && !url.pathname.endsWith('/state')) {
      if (!adminAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      const id = url.pathname.replace('/api/source-catalog/', '');
      if (!id) {
        sendJson(response, 400, { error: 'Missing source ID', code: 'BAD_REQUEST' });
        return;
      }
      try {
        const catalog = await readSourceCatalog();
        if (!catalog.some((e) => e.id === id)) {
          sendJson(response, 404, { error: 'Source not found', code: 'NOT_FOUND' });
          return;
        }
        const updated = removeSourceFromCatalog(catalog, id);
        await writeSourceCatalog(updated);
        const sourceState = await readSourceState();
        sendJson(response, 200, { ok: true, summary: summarizeSourceCatalog(updated, sourceState) });
      } catch (err) {
        console.error('[api] source-catalog delete error:', err.message);
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/source-catalog/import') {
      if (!adminAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      let body;
      try { body = await readJsonBody(request, 512_000); }
      catch (e) { const { status, body: b } = classifyError(e); sendJson(response, status, b); return; }
      if (!Array.isArray(body.feeds) || body.feeds.length === 0) {
        sendJson(response, 400, { error: 'Missing or empty feeds array', code: 'BAD_REQUEST' });
        return;
      }
      try {
        const catalog = await readSourceCatalog();
        const previousCount = catalog.length;
        const updated = importSourcesToCatalog(catalog, body.feeds);
        await writeSourceCatalog(updated);
        const sourceState = await readSourceState();
        const addedCount = updated.length - previousCount;
        sendJson(response, 200, { ok: true, addedCount, totalCount: updated.length, summary: summarizeSourceCatalog(updated, sourceState) });
      } catch (err) {
        console.error('[api] source-catalog import error:', err.message);
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/source-catalog/re-enable') {
      if (!adminAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      let body;
      try { body = await readJsonBody(request); }
      catch (e) { const { status, body: b } = classifyError(e); sendJson(response, status, b); return; }
      const id = String(body.id || '').trim();
      if (!id) {
        sendJson(response, 400, { error: 'Missing source ID', code: 'BAD_REQUEST' });
        return;
      }
      try {
        const catalog = await readSourceCatalog();
        if (!catalog.some((e) => e.id === id)) {
          sendJson(response, 404, { error: 'Source not found', code: 'NOT_FOUND' });
          return;
        }
        const updated = reEnableSourceInCatalog(catalog, id);
        await writeSourceCatalog(updated);
        const sourceState = await readSourceState();
        const reEnabledEntry = updated.find((e) => e.id === id);
        sendJson(response, 200, { ok: true, source: reEnabledEntry, summary: summarizeSourceCatalog(updated, sourceState) });
      } catch (err) {
        console.error('[api] source-catalog re-enable error:', err.message);
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    // ── Source catalog export (raw JSON download) ────────────────────────────
    if (request.method === 'GET' && url.pathname === '/api/source-catalog/export') {
      if (!adminAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      try {
        const catalog = await readSourceCatalog();
        const sourceState = await readSourceState();
        const hydrated = hydrateSourceCatalog(catalog, sourceState);
        sendJson(response, 200, { feeds: hydrated, exportedAt: new Date().toISOString() }, {
          'content-disposition': 'attachment; filename="source-catalog-export.json"'
        });
      } catch (err) {
        console.error('[api] source-catalog export error:', err.message);
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/coverage-history') {
      const limit = Math.max(1, Math.min(48, Number(url.searchParams.get('limit') || 8)));
      const transitions = Math.max(1, Math.min(40, Number(url.searchParams.get('transitions') || 16)));
      const includeRegionSeries = url.searchParams.get('regions') === '1';
      const topN = Math.max(1, Math.min(30, Number(url.searchParams.get('topN') || 20)));
      sendJson(response, 200, getCoverageHistory(limit, transitions, { includeRegionSeries, topN }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/coverage-region') {
      const iso = (url.searchParams.get('iso') || '').trim().toUpperCase();
      if (!iso) { sendJson(response, 400, { error: 'Missing iso query parameter', code: 'BAD_REQUEST' }); return; }
      const limit = Math.max(1, Math.min(24, Number(url.searchParams.get('limit') || 10)));
      const transitions = Math.max(1, Math.min(24, Number(url.searchParams.get('transitions') || 8)));
      sendJson(response, 200, getRegionCoverageHistory(iso, limit, transitions));
      return;
    }

    // ── Historical snapshot queries ──

    if (request.method === 'GET' && url.pathname === '/api/snapshot-history/timestamps') {
      try { await requireProFeature(request, 'historicalQueries'); }
      catch (err) { const { status, body: b } = classifyError(err); sendJson(response, status, b); return; }
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const timestamps = await withTimeout(() => readSnapshotTimestamps(from, to));
      sendJson(response, 200, { timestamps }, {
        'cache-control': 'public, max-age=60, stale-while-revalidate=120'
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/snapshot-history') {
      try { await requireProFeature(request, 'historicalQueries'); }
      catch (err) { const { status, body: b } = classifyError(err); sendJson(response, status, b); return; }
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const limit = Math.max(1, Math.min(168, Number(url.searchParams.get('limit') || 48)));
      const snapshots = await withTimeout(() => readSnapshotHistory(from, to, limit));
      sendJson(response, 200, { snapshots }, {
        'cache-control': 'public, max-age=60, stale-while-revalidate=120'
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/region-briefing') {
      const iso = (url.searchParams.get('iso') || '').trim().toUpperCase();
      if (!iso) { sendJson(response, 400, { error: 'Missing iso query parameter', code: 'BAD_REQUEST' }); return; }
      sendJson(response, 200, await withTimeout(() => getRegionBriefing(iso)));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/refresh') {
      // Admin-only — full ingest is heavy, so it must not be a public DoS surface.
      if (!adminPasswordConfigured()) {
        sendJson(response, 503, { error: 'ADMIN_PASSWORD not configured', code: 'SERVICE_UNAVAILABLE' });
        return;
      }
      if (!adminAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      // Cool-down: an admin loop calling /api/refresh in tight succession can
      // still hammer the backend even though only admins reach this point.
      // 60s between consecutive runs is comfortably above ingest duration.
      const now = Date.now();
      if (now - lastManualRefreshAt < MANUAL_REFRESH_COOLDOWN_MS) {
        const retryAfter = Math.ceil((MANUAL_REFRESH_COOLDOWN_MS - (now - lastManualRefreshAt)) / 1000);
        sendJson(response, 429, { error: 'Refresh cooldown active', code: 'RATE_LIMITED', retryAfter }, { 'retry-after': String(retryAfter) });
        return;
      }
      lastManualRefreshAt = now;
      const briefing = await withTimeout(() => refreshSnapshot({ force: true, reason: 'manual' }), 120_000);
      sendJson(response, 200, briefing);
      return;
    }

    // ── Admin health (uses server's cached data, but auth logic is shared) ──

    if (request.method === 'GET' && url.pathname === '/api/admin-health') {
      if (!adminPasswordConfigured()) {
        sendJson(response, 503, { error: 'ADMIN_PASSWORD not configured', code: 'SERVICE_UNAVAILABLE' });
        return;
      }
      if (!adminAuthorized(request)) {
        sendJson(response, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      sendJson(response, 200, await withTimeout(() => buildAdminHealthResponse()));
      return;
    }

    // ── Admin session (httpOnly cookie; optional X-Admin-Password for scripts) ──

    if (request.method === 'POST' && url.pathname === '/api/admin/session') {
      if (checkAdminRateLimit(request)) {
        sendJson(response, 429, { error: 'Too many attempts', code: 'RATE_LIMITED' });
        return;
      }
      if (!adminPasswordConfigured()) {
        sendJson(response, 503, { error: 'ADMIN_PASSWORD not configured', code: 'SERVICE_UNAVAILABLE' });
        return;
      }
      if (!canIssueAdminSession()) {
        sendJson(response, 503, { error: 'Admin session signing not configured', code: 'SERVICE_UNAVAILABLE' });
        return;
      }
      let body;
      try {
        body = await readJsonBody(request);
      } catch (e) {
        const { status, body: b } = classifyError(e);
        sendJson(response, status, b);
        return;
      }
      const password = String(body.password || '').trim();
      if (!timingSafeEqual(password, getAdminPassword())) {
        sendJson(response, 401, { error: 'Invalid password', code: 'UNAUTHORIZED' });
        return;
      }
      const token = createSessionToken();
      if (!token) {
        sendJson(response, 500, { error: 'Internal server error', code: 'INTERNAL_ERROR' });
        return;
      }
      const secure = isHttpsRequest(request);
      sendJsonWithCookies(response, 200, { ok: true }, [buildSetSessionCookie(token, secure)], url.pathname);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/session') {
      const tok = getSessionTokenFromCookie(request.headers.cookie);
      const ok = Boolean(tok && verifySessionToken(tok));
      sendJson(response, 200, { ok });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/logout') {
      const secure = isHttpsRequest(request);
      sendJsonWithCookies(response, 200, { ok: true }, [buildClearSessionCookie(secure)], url.pathname);
      return;
    }

    // Legacy JSON check (no cookie) — used by some API clients
    if (request.method === 'POST' && url.pathname === '/api/admin-auth') {
      if (checkAdminRateLimit(request)) {
        sendJson(response, 429, { error: 'Too many attempts', code: 'RATE_LIMITED' });
        return;
      }
      if (!adminPasswordConfigured()) {
        sendJson(response, 500, { error: 'ADMIN_PASSWORD not configured' });
        return;
      }
      let body;
      try {
        body = await readJsonBody(request);
      } catch (e) {
        const { status, body: b } = classifyError(e);
        sendJson(response, status, b);
        return;
      }
      const password = String(body.password || '').trim();
      if (timingSafeEqual(password, getAdminPassword())) {
        return sendJson(response, 200, { ok: true });
      }
      return sendJson(response, 401, { error: 'Invalid password' });
    }

    // ── Stripe Integration ──

    if (request.method === 'POST' && url.pathname === '/api/stripe/create-checkout-session') {
      try {
        const user = await requireUser(request);
        let body;
        try { body = await readJsonBody(request); }
        catch (e) { const { status, body: b } = classifyError(e); sendJson(response, status, b); return; }
        // userId/email are derived from the verified token. Body fields are ignored.
        const successUrl = String(body.successUrl || '').trim();
        const cancelUrl = String(body.cancelUrl || '').trim();
        const result = await withTimeout(() =>
          createCheckoutSession({ user, successUrl, cancelUrl }),
        );
        sendJson(response, 200, result);
      } catch (err) {
        log.warn('stripe_checkout_error', { msg: err.message, code: err.code });
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/stripe/create-portal-session') {
      try {
        const user = await requireUser(request);
        let body;
        try { body = await readJsonBody(request); }
        catch (e) { const { status, body: b } = classifyError(e); sendJson(response, status, b); return; }
        // customerId is NEVER trusted from the body. createPortalSession looks
        // it up server-side from the authenticated user's $users record.
        const returnUrl = String(body.returnUrl || '').trim();
        const result = await withTimeout(() => createPortalSession({ user, returnUrl }));
        sendJson(response, 200, result);
      } catch (err) {
        log.warn('stripe_portal_error', { msg: err.message, code: err.code });
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    // ── Story Threads ──
    if (request.method === 'GET' && url.pathname === '/api/threads') {
      try {
        const user = await requireUser(request);
        const status = url.searchParams.get('status') || 'active';
        const threads = await withTimeout(() => listThreadsForUser({ userId: user.id, status }));
        sendJson(response, 200, { threads });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/alerts/digest-sweep') {
      if (!adminAuthorized(request)) { sendJson(response, 401, { error: 'admin required' }); return; }
      try {
        const dryRun = url.searchParams.get('dry') === '1';
        const out = await withTimeout(() => runDigestSweep({ baseUrl: process.env.MAPR_PUBLIC_URL, dryRun }), 60_000);
        sendJson(response, 200, out);
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/alerts/daily-digest') {
      if (!adminAuthorized(request)) { sendJson(response, 401, { error: 'admin required' }); return; }
      try {
        const dryRun = url.searchParams.get('dry') === '1';
        const out = await withTimeout(() => runDailyDigestSweep({ baseUrl: process.env.MAPR_PUBLIC_URL, dryRun }), 60_000);
        sendJson(response, 200, out);
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/threads') {
      try {
        const user = await requireUser(request);
        let body;
        try { body = await readJsonBody(request); }
        catch (e) { const { status, body: b } = classifyError(e); sendJson(response, status, b); return; }
        const thread = await withTimeout(() => createThread({
          userId: user.id,
          title: body.title,
          seedEventId: body.seedEventId || null,
          seedArticleId: body.seedArticleId || null,
        }));
        sendJson(response, 201, { thread });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/events/') && url.pathname.endsWith('/brief')) {
      try {
        const eventId = url.pathname.replace(/^\/api\/events\//, '').replace(/\/brief$/, '');
        if (!eventId) {
          sendJson(response, 400, { error: 'Missing event id' });
          return;
        }
        const brief = await withTimeout(() => readLatestBrief(eventId));
        sendJson(response, 200, { brief, cached: Boolean(brief) });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'POST' && url.pathname.startsWith('/api/events/') && url.pathname.endsWith('/brief')) {
      try {
        const user = await requireUser(request);
        const eventId = url.pathname.replace(/^\/api\/events\//, '').replace(/\/brief$/, '');
        let body = {};
        try { body = await readJsonBody(request); } catch { /* empty body OK */ }
        const event = await readEventById(eventId);
        if (!event) {
          sendJson(response, 404, { error: 'Event not found' });
          return;
        }
        try {
          const result = await withTimeout(
            () => generateBrief({ event, force: Boolean(body.force), ownerUserId: user.id }),
            60_000,
          );
          sendJson(response, 200, result);
        } catch (e) {
          if (e?.code === 'AI_HOMEPC_NOT_CONFIGURED' || e?.code === 'AI_WORKERSAI_NOT_CONFIGURED') {
            sendJson(response, 503, { error: e.message, code: 'AI_NOT_CONFIGURED' });
            return;
          }
          if (e?.code === 'NO_ARTICLES') {
            sendJson(response, 409, { error: e.message, code: 'NO_ARTICLES' });
            return;
          }
          throw e;
        }
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    // ── D6: reporter prompt ─────────────────────────────────────────────
    if (request.method === 'GET' && /^\/api\/events\/[^/]+\/reporter-prompt$/.test(url.pathname)) {
      try {
        const eventId = url.pathname.split('/')[3];
        const row = await withTimeout(() => readLatestReporterPrompt(eventId));
        sendJson(response, 200, row || { questions: [], reporters: [], generatedAt: null });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }
    if (request.method === 'POST' && /^\/api\/events\/[^/]+\/reporter-prompt$/.test(url.pathname)) {
      try {
        await requireUser(request);
        const eventId = url.pathname.split('/')[3];
        let body = {};
        try { body = await readJsonBody(request); } catch { /* empty body OK */ }
        try {
          const row = await withTimeout(
            () => generateReporterPromptForEvent({ eventId, force: Boolean(body.force) }),
            60_000,
          );
          sendJson(response, 200, row);
        } catch (e) {
          if (e?.code === 'AI_HOMEPC_NOT_CONFIGURED' || e?.code === 'AI_WORKERSAI_NOT_CONFIGURED') {
            sendJson(response, 503, { error: e.message, code: 'AI_NOT_CONFIGURED' });
            return;
          }
          throw e;
        }
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    // ── D7: why-now context ─────────────────────────────────────────────
    if (request.method === 'GET' && /^\/api\/events\/[^/]+\/why-now$/.test(url.pathname)) {
      try {
        const eventId = url.pathname.split('/')[3];
        const row = await withTimeout(() => readLatestWhyNow(eventId));
        sendJson(response, 200, row || { context: '', precedents: [], generatedAt: null });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }
    if (request.method === 'POST' && /^\/api\/events\/[^/]+\/why-now$/.test(url.pathname)) {
      try {
        await requireUser(request);
        const eventId = url.pathname.split('/')[3];
        let body = {};
        try { body = await readJsonBody(request); } catch { /* empty body OK */ }
        try {
          const row = await withTimeout(
            () => generateWhyNowForEvent({ eventId, force: Boolean(body.force) }),
            60_000,
          );
          sendJson(response, 200, row);
        } catch (e) {
          if (e?.code === 'AI_HOMEPC_NOT_CONFIGURED' || e?.code === 'AI_WORKERSAI_NOT_CONFIGURED') {
            sendJson(response, 503, { error: e.message, code: 'AI_NOT_CONFIGURED' });
            return;
          }
          throw e;
        }
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    // ── D4: narrative arcs ──────────────────────────────────────────────
    if (request.method === 'GET' && url.pathname === '/api/arcs') {
      try {
        const limit = Math.max(1, Math.min(48, Number(url.searchParams.get('limit')) || 24));
        const status = url.searchParams.get('status') || 'active';
        const arcs = await withTimeout(() => listActiveArcs({ limit, status }));
        sendJson(response, 200, { arcs });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'GET' && /^\/api\/arcs\/[^/]+$/.test(url.pathname)) {
      try {
        const arcId = url.pathname.split('/')[3];
        const arc = await withTimeout(() => readArc(arcId));
        if (!arc) { sendJson(response, 404, { error: 'arc not found' }); return; }
        sendJson(response, 200, { arc });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'GET' && /^\/api\/events\/[^/]+\/arcs$/.test(url.pathname)) {
      try {
        const eventId = url.pathname.split('/')[3];
        const arcs = await withTimeout(() => readArcsForEvent(eventId));
        sendJson(response, 200, { arcs });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/arcs/refresh') {
      if (!adminAuthorized(request)) { sendJson(response, 401, { error: 'admin required' }); return; }
      try {
        const dryRun = url.searchParams.get('dry') === '1';
        const out = await withTimeout(
          () => runNarrativeArcSweep({ dryRun }),
          120_000,
        );
        sendJson(response, 200, out);
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/events/') && url.pathname.endsWith('/credibility')) {
      try {
        const id = url.pathname.replace(/^\/api\/events\//, '').replace(/\/credibility$/, '');
        if (!id) {
          sendJson(response, 400, { error: 'Missing event id' });
          return;
        }
        const [result, contradictionRow] = await Promise.all([
          withTimeout(() => buildCredibilityForEvent(id)),
          withTimeout(() => readLatestContradictions(id)).catch(() => null),
        ]);
        result.contradictions = contradictionRow?.contradictions || [];
        result.contradictionsGeneratedAt = contradictionRow?.generatedAt || null;
        sendJson(response, 200, result);
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'GET' && /^\/api\/events\/[^/]+\/contradictions$/.test(url.pathname)) {
      try {
        const id = url.pathname.split('/')[3];
        const row = await withTimeout(() => readLatestContradictions(id));
        sendJson(response, 200, {
          contradictions: row?.contradictions || [],
          generatedAt: row?.generatedAt || null,
          modelUsed: row?.modelUsed || null,
        });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'POST' && /^\/api\/events\/[^/]+\/contradictions$/.test(url.pathname)) {
      try {
        await requireUser(request);
        const id = url.pathname.split('/')[3];
        let body = {};
        try { body = await readJsonBody(request); } catch { /* allow empty body */ }
        try {
          const row = await withTimeout(
            () => generateContradictionsForEvent({ eventId: id, force: Boolean(body.force) }),
            60_000,
          );
          sendJson(response, 200, row);
        } catch (e) {
          if (e?.code === 'AI_HOMEPC_NOT_CONFIGURED' || e?.code === 'AI_WORKERSAI_NOT_CONFIGURED') {
            sendJson(response, 503, { error: e.message, code: 'AI_NOT_CONFIGURED' });
            return;
          }
          throw e;
        }
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/api/threads/')) {
      try {
        const user = await requireUser(request);
        const threadId = url.pathname.replace('/api/threads/', '');
        const ok = await withTimeout(() => archiveThread({ userId: user.id, threadId }));
        sendJson(response, ok ? 200 : 404, { ok });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    // ── AI Q&A sidebar (Workstream D1) ─────────────────────────────────
    // Free tier: 10 user messages / trailing 30 days. Pro: 200.
    if (request.method === 'GET' && url.pathname === '/api/qa/conversations') {
      try {
        const user = await requireUser(request);
        const includeArchived = url.searchParams.get('archived') === '1';
        const conversations = await withTimeout(
          () => listQaConversations({ user, archived: includeArchived }),
        );
        sendJson(response, 200, { conversations });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/qa/conversations') {
      try {
        const user = await requireUser(request);
        let body = {};
        try { body = await readJsonBody(request); } catch { /* empty body ok */ }
        const conversation = await withTimeout(() => createQaConversation({
          user,
          title: body?.title,
          useCurrentFilters: Boolean(body?.useCurrentFilters),
        }));
        sendJson(response, 201, { conversation });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    // GET /api/qa/conversations/:id/messages
    if (request.method === 'GET' && /^\/api\/qa\/conversations\/[^/]+\/messages$/.test(url.pathname)) {
      try {
        const user = await requireUser(request);
        const conversationId = url.pathname.split('/')[4];
        const messages = await withTimeout(() => readQaMessages({ user, conversationId }));
        sendJson(response, 200, { messages });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    // POST /api/qa/conversations/:id/messages  — the central handler.
    if (request.method === 'POST' && /^\/api\/qa\/conversations\/[^/]+\/messages$/.test(url.pathname)) {
      try {
        const { authedUser: user, record } = await getRequestUserRecord(request);
        const tier = record?.subscriptionStatus === 'pro' || record?.subscriptionStatus === 'pro_plus'
          ? 'pro'
          : 'free';
        const quotaLimit = tier === 'pro' ? 200 : 10;

        const conversationId = url.pathname.split('/')[4];
        let body;
        try { body = await readJsonBody(request); }
        catch (e) { const { status, body: b } = classifyError(e); sendJson(response, status, b); return; }
        const content = String(body?.content || '').trim();
        if (!content) { sendJson(response, 400, { error: 'content required' }); return; }

        // Quota check FIRST so we don't spend tokens on a rejected request.
        const used = await qaUserMessageCount({ user });
        if (used >= quotaLimit) {
          sendJson(response, 429, {
            error: 'monthly quota exceeded',
            code: 'QUOTA_EXCEEDED',
            quota: { used, limit: quotaLimit, tier },
          });
          return;
        }

        // Verify conversation ownership (throws 404 otherwise) + capture
        // current useCurrentFilters preference for retrieval scoping.
        const parent = await getQaConversation({ user, conversationId });

        // Filter-context support: clients pass current filter state in
        // body.filters when the conversation is set to "use current filters".
        // The retrieval module reads region/timeWindow from it.
        const filters = (parent.useCurrentFilters || body?.useCurrentFilters)
          ? (body?.filters || {})
          : {};
        // If the body indicates a desire to flip the sticky setting, persist it.
        if (typeof body?.useCurrentFilters === 'boolean'
            && body.useCurrentFilters !== Boolean(parent.useCurrentFilters)) {
          await setQaConversationUseFilters({
            user, conversationId, value: body.useCurrentFilters,
          }).catch(() => {});
        }

        // Persist the user message first so the UI sees an immediate write.
        const userMessage = await appendQaMessage({
          user, conversationId, role: 'user', content,
        });

        // Read only the recent turns needed for conversational context. Pulling
        // the full chat history from InstantDB on every send adds avoidable
        // latency to the hot path.
        const priorMessages = await readQaMessages({ user, conversationId, limit: 12 });

        // AI/RAG call. The Mapr backend calls exactly one stable AI Gateway URL.
        // Retrieval, embeddings, queueing/backpressure, and model generation all
        // happen behind /v1/qa; the backend never talks to Ollama, vector search,
        // Redis, or an internal ai-worker directly.
        let assistantMessage;
        try {
          const requestId = crypto.randomUUID();
          const result = await withTimeout(() => callAiGatewayQa({
            requestId,
            conversationId,
            question: content,
            priorMessages,
            filters: {
              timeWindowHours: filters.timeWindowHours || 168,
              region: filters.region || null,
            },
          }), Number(process.env.MAPR_AI_QA_GATEWAY_TIMEOUT_MS || 75_000));
          assistantMessage = await appendQaMessage({
            user, conversationId,
            role: 'assistant',
            content: result.answer,
            citations: result.citations,
            modelUsed: result.modelUsed,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
          });
        } catch (e) {
          if (e?.code === 'AI_NOT_CONFIGURED') {
            sendJson(response, 503, {
              error: e.message,
              code: 'AI_NOT_CONFIGURED',
              userMessage,
            });
            return;
          }
          sendJson(response, e?.statusCode || 502, {
            error: e?.message || 'AI generation failed',
            code: e?.code || 'AI_GENERATE_FAILED',
            userMessage,
          });
          return;
        }

        sendJson(response, 200, {
          userMessage,
          assistantMessage,
          quota: { used: used + 1, limit: quotaLimit, tier },
        });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    // DELETE /api/qa/conversations/:id  → archive (soft delete)
    if (request.method === 'DELETE' && /^\/api\/qa\/conversations\/[^/]+$/.test(url.pathname)) {
      try {
        const user = await requireUser(request);
        const conversationId = url.pathname.split('/')[4];
        const ok = await withTimeout(() => archiveQaConversation({ user, conversationId }));
        sendJson(response, ok ? 200 : 404, { ok });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    // ── D5: entity dossiers ─────────────────────────────────────────────
    // GET  /api/entities/:key/dossier        — cached row (no auth)
    // POST /api/entities/:key/dossier        — regenerate (auth required)
    //   body: { name: 'Display Name', type: 'person' | 'organization' | 'location' }
    if (request.method === 'GET' && /^\/api\/entities\/[^/]+\/dossier$/.test(url.pathname)) {
      try {
        const rawKey = decodeURIComponent(url.pathname.split('/')[3]);
        const entityKey = normalizeEntityKey(rawKey);
        const row = await withTimeout(() => readLatestDossier({ entityKey }));
        sendJson(response, 200, row || { entityKey, summary: '', generatedAt: null });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }
    if (request.method === 'POST' && /^\/api\/entities\/[^/]+\/dossier$/.test(url.pathname)) {
      try {
        await requireUser(request);
        const rawKey = decodeURIComponent(url.pathname.split('/')[3]);
        let body = {};
        try { body = await readJsonBody(request); } catch { /* empty body OK */ }
        const name = String(body?.name || rawKey).slice(0, 200);
        const type = String(body?.type || 'entity').toLowerCase();
        try {
          const row = await withTimeout(
            () => generateEntityDossier({ name, type, force: Boolean(body?.force) }),
            60_000,
          );
          sendJson(response, 200, row);
        } catch (e) {
          if (e?.code === 'AI_HOMEPC_NOT_CONFIGURED' || e?.code === 'AI_WORKERSAI_NOT_CONFIGURED') {
            sendJson(response, 503, { error: e.message, code: 'AI_NOT_CONFIGURED' });
            return;
          }
          throw e;
        }
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    // Server-of-record subscription state. Clients should prefer this over the
    // local InstantDB $users field (which is read-only after the perms file is
    // applied) for any UI that drives access control.
    if (request.method === 'GET' && url.pathname === '/api/me') {
      try {
        const { authedUser, record } = await getRequestUserRecord(request);
        sendJson(response, 200, {
          user: { id: authedUser.id, email: authedUser.email },
          subscriptionStatus: record?.subscriptionStatus || 'free',
          stripeCustomerId: record?.stripeCustomerId || null,
        });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    // ── D2: beat-aware semantic alerts ─────────────────────────────────
    if (request.method === 'GET' && url.pathname === '/api/me/beat') {
      try {
        const user = await requireUser(request);
        const profile = await withTimeout(() => readBeatProfile(user.id));
        sendJson(response, 200, { profile: profile || null });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'PUT' && url.pathname === '/api/me/beat') {
      try {
        const user = await requireUser(request);
        let body = {};
        try { body = await readJsonBody(request); }
        catch (e) { const { status, body: b } = classifyError(e); sendJson(response, status, b); return; }
        const profile = await withTimeout(
          () => upsertBeatProfile({ userId: user.id, description: body?.description }),
          30_000,
        );
        sendJson(response, 200, { profile });
      } catch (err) {
        if (err?.code === 'AI_HOMEPC_NOT_CONFIGURED' || err?.code === 'AI_WORKERSAI_NOT_CONFIGURED') {
          sendJson(response, 503, { error: err.message, code: 'AI_NOT_CONFIGURED' });
          return;
        }
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'DELETE' && url.pathname === '/api/me/beat') {
      try {
        const user = await requireUser(request);
        const ok = await withTimeout(() => deleteBeatProfile(user.id));
        sendJson(response, ok ? 200 : 404, { ok });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/me/beat/matches') {
      try {
        const user = await requireUser(request);
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 20));
        const minSimilarity = Number(url.searchParams.get('minSimilarity')) || 0.5;
        const windowHours = Number(url.searchParams.get('windowHours')) || 168;
        const sinceIso = url.searchParams.get('since') || null;
        const matches = await withTimeout(() => matchBeatForUser({
          userId: user.id, limit, minSimilarity, windowHours, sinceIso,
        }));
        sendJson(response, 200, { matches });
      } catch (err) {
        const { status, body: b } = classifyError(err);
        sendJson(response, status, b);
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/stripe/webhook') {
      let rawBody;
      try { rawBody = await readRawBody(request); }
      catch (e) { const { status, body: b } = classifyError(e); sendJson(response, status, b); return; }
      const signature = String(request.headers['stripe-signature'] || '').trim();
      if (!signature) { sendJson(response, 400, { error: 'Missing Stripe-Signature header' }); return; }
      // No timeout wrapper here: handler is already two-phase idempotent. A
      // 504 to Stripe after we mark `processed_at` would trigger a retry that
      // dedupes; if we 504 *before* mark, the retry resumes processing.
      try {
        const result = await handleStripeWebhook(rawBody, signature);
        sendJson(response, 200, result);
      } catch (err) {
        console.error('[api] stripe webhook error:', err.message);
        if (err.code === 'INVALID_SIGNATURE') {
          sendJson(response, 400, { error: 'Invalid webhook signature' });
        } else {
          const { status, body: b } = classifyError(err);
          sendJson(response, status, b);
        }
      }
      return;
    }

    if (url.pathname === '/api/gdelt-proxy') {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, corsHeadersForPath(url.pathname));
        response.end();
        return;
      }
      await withTimeout(() => handleGdeltProxy(request, response, url));
      return;
    }

    // ── Serve static frontend from dist/ ──
    if (HAS_DIST && request.method === 'GET' && !url.pathname.startsWith('/api/')) {
      // Strip .. and leading slash, then join. Verify result stays within DIST_DIR.
      const safeName = url.pathname.replace(/\.\./g, '').replace(/^\/+/, '');
      const filePath = join(DIST_DIR, safeName);
      if (!filePath.startsWith(DIST_DIR)) {
        sendJson(response, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
        return;
      }
      if (safeName && existsSync(filePath) && statSync(filePath).isFile()) {
        serveStaticFile(response, filePath);
        return;
      }
      // SPA fallback — serve index.html for all non-API routes
      const indexPath = join(DIST_DIR, 'index.html');
      if (existsSync(indexPath)) {
        serveStaticFile(response, indexPath);
        return;
      }
    }

    sendJson(response, 404, { error: 'Not found', code: 'NOT_FOUND' });
  } catch (error) {
    const { status, body } = classifyError(error);
    sendJson(response, status, body);
  }
});

// ── Rate limiter for admin auth endpoints ──
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const rateLimitMap = new Map();

// Manual /api/refresh cooldown — admins still shouldn't be able to chain
// full ingests faster than the pipeline can complete.
const MANUAL_REFRESH_COOLDOWN_MS = 60_000;
let lastManualRefreshAt = 0;

// Number of trusted proxy hops between this server and the public client.
// On Railway = 1 (Railway proxy). If behind a CDN that also writes XFF, set
// to 2. Defaults to 1 to avoid trusting attacker-controlled XFF entries.
const TRUSTED_PROXY_HOPS = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1);

function getClientIp(request) {
  // Right-most TRUSTED_PROXY_HOPS entries are written by trusted proxies; the
  // last of those is the closest trusted hop's view of the real client. Any
  // entries further left are attacker-controlled and must be ignored.
  const forwarded = String(request.headers['x-forwarded-for'] || '');
  if (forwarded) {
    const ips = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
    if (ips.length >= TRUSTED_PROXY_HOPS) {
      const idx = ips.length - TRUSTED_PROXY_HOPS;
      const candidate = ips[idx];
      if (candidate) return candidate;
    }
  }
  return String(request.socket?.remoteAddress || 'unknown');
}

/** Returns true if the request should be rate-limited (blocked). */
function checkAdminRateLimit(request) {
  const ip = getClientIp(request);
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.windowEnd) {
    rateLimitMap.set(ip, { count: 1, windowEnd: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX_ATTEMPTS) {
    return true;
  }
  return false;
}

// Periodic cleanup of expired rate-limit entries (every 5 min)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.windowEnd) rateLimitMap.delete(ip);
  }
}, 300_000).unref();

// Constant-time comparison lives in ./adminAuth.js (timingSafeEqualString) so
// the server route handlers and the shared isAdminAuthorized helper agree on
// implementation. Re-exported here under a short local alias.
const timingSafeEqual = timingSafeEqualString;

// Start server FIRST so healthcheck passes, then initialize data in background
const HOST = process.env.HOST || '0.0.0.0';
log.info('mapr_server_starting', { host: HOST, port: PORT, databaseUrl: process.env.DATABASE_URL ? 'set' : 'not_set' });

server.listen(PORT, HOST, async () => {
  log.info('mapr_server_listening', { host: HOST, port: PORT });
  try {
    await initializeIngestion();
  } catch (err) {
    log.error('Ingestion initialization failed', { message: err.message });
  }

  startScheduler();
  if (process.env.ENABLE_TRACKING === 'true') {
    startFlightTracking();
    startShipTracking();
  } else {
    console.log('[server] Tracking disabled (set ENABLE_TRACKING=true to enable)');
  }
  if (process.env.AISSTREAM_API_KEY) {
    startBatchPush((vessels) => {
      if (sseClientCount() === 0) return;
      sseBroadcast('vessels-update', {
        vessels,
        fetchedAt: new Date().toISOString()
      });
    });
  }
  console.log('Scheduler and trackers started.');

  // Alert digest sweep — runs every 15 min. No-ops when InstantDB admin
  // token or Resend API key are unset.
  const DIGEST_INTERVAL_MS = Number(process.env.MAPR_DIGEST_INTERVAL_MS || 15 * 60 * 1000);
  if (DIGEST_INTERVAL_MS > 0 && process.env.DISABLE_DIGEST_SWEEP !== 'true') {
    setInterval(() => {
      runDigestSweep({ baseUrl: process.env.MAPR_PUBLIC_URL }).catch((err) => {
        log.warn('digest_sweep_error', { msg: err.message });
      });
    }, DIGEST_INTERVAL_MS).unref();
    log.info('digest_sweep_started', { intervalMs: DIGEST_INTERVAL_MS });
  }

  // Daily watchlist digest — runs every hour; per-user cadence enforced
  // inside the sweep against $users.lastDailyDigestSentAt.
  const DAILY_DIGEST_INTERVAL_MS = Number(process.env.MAPR_DAILY_DIGEST_INTERVAL_MS || 60 * 60 * 1000);
  if (DAILY_DIGEST_INTERVAL_MS > 0 && process.env.DISABLE_DAILY_DIGEST !== 'true') {
    setInterval(() => {
      runDailyDigestSweep({ baseUrl: process.env.MAPR_PUBLIC_URL }).catch((err) => {
        log.warn('daily_digest_sweep_error', { msg: err.message });
      });
    }, DAILY_DIGEST_INTERVAL_MS).unref();
    log.info('daily_digest_sweep_started', { intervalMs: DAILY_DIGEST_INTERVAL_MS });
  }

  // D4: narrative arc sweep — runs every 6 h. No-ops cleanly when the
  // AI worker is unconfigured or no durable clusters exist.
  const ARC_SWEEP_INTERVAL_MS = Number(process.env.MAPR_ARC_SWEEP_INTERVAL_MS || 6 * 60 * 60 * 1000);
  if (ARC_SWEEP_INTERVAL_MS > 0 && process.env.DISABLE_ARC_REFRESH !== 'true') {
    // Fire once shortly after boot (60s) so an admin can see the first
    // result without waiting 6 h, then settle into the interval.
    setTimeout(() => {
      runNarrativeArcSweep().catch((err) => log.warn('arc_sweep_error_initial', { msg: err.message }));
    }, 60_000).unref();
    setInterval(() => {
      runNarrativeArcSweep().catch((err) => log.warn('arc_sweep_error', { msg: err.message }));
    }, ARC_SWEEP_INTERVAL_MS).unref();
    log.info('arc_sweep_started', { intervalMs: ARC_SWEEP_INTERVAL_MS });
  }

  // Railway sleep is enabled — no keep-alive ping needed.
  // The app will sleep after inactivity and wake on incoming requests.
});

server.on('error', (err) => {
  log.error('server_error', { msg: err.message });
  // Do NOT process.exit(1) directly — drop in-flight requests, leak PG conns,
  // and skip closeStorage. Let shutdown() run with a hard timeout.
  shutdown('server_error').catch(() => process.exit(1));
});

let _shuttingDown = false;
async function shutdown(reason = 'signal') {
  if (_shuttingDown) return;
  _shuttingDown = true;
  log.info('server_shutdown_begin', { reason });

  // Hard timeout — Railway/K8s SIGKILLs at 30s by default. Bail out before that
  // so we always run closeStorage and don't leak PG connections.
  const hardKill = setTimeout(() => {
    log.error('server_shutdown_timeout');
    process.exit(1);
  }, 10_000);
  hardKill.unref();

  try {
    stopScheduler();
    stopFlightTracking();
    stopShipTracking();
    await new Promise((resolve) => server.close(() => resolve()));
    await closeStorage();
    log.info('server_shutdown_done');
    process.exit(0);
  } catch (err) {
    log.error('server_shutdown_failed', { msg: err.message });
    process.exit(1);
  }
}

process.on('SIGINT', () => { shutdown('SIGINT'); });
process.on('SIGTERM', () => { shutdown('SIGTERM'); });

// Without these, any unhandled async error tears down the process with no
// structured log and leaks connections. Log loudly, then trigger graceful
// shutdown so the next deploy/restart starts clean.
process.on('unhandledRejection', (reason) => {
  log.error('unhandled_rejection', {
    msg: reason?.message || String(reason),
    stack: reason?.stack,
  });
});

process.on('uncaughtException', (err) => {
  log.error('uncaught_exception', { msg: err.message, stack: err.stack });
  // Per Node docs, after uncaughtException the process is in an undefined
  // state — best to shut down rather than continue serving.
  shutdown('uncaughtException').catch(() => process.exit(1));
});
