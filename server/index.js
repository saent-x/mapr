import http from 'node:http';
import { buildAdminHealthPayload, mergeAdminHealthPayloads } from '../src/utils/healthSummary.js';
import { closeStorage } from './storage.js';
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
import { getCircuitSummary } from './circuitBreaker.js';
import {
  addClient as addSseClient,
  removeClient as removeSseClient,
  broadcast as sseBroadcast,
  clientCount as sseClientCount
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

// Shared route handlers (originally written for serverless; invoked from this Node server)
import gdeltProxyHandler from '../api/gdelt-proxy.js';
import sourceCatalogHandler from '../api/source-catalog.js';

const PORT = Number(process.env.PORT || process.env.MAPR_API_PORT || 3030);
const API_TIMEOUT_MS = 30_000; // 30s timeout for API request handlers

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'Content-Type, X-Admin-Password',
};

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    ...CORS_HEADERS,
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

/** @param {string[]} setCookieValues */
function sendJsonWithCookies(response, statusCode, payload, setCookieValues) {
  response.statusCode = statusCode;
  for (const [k, v] of Object.entries({
    ...CORS_HEADERS,
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

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    ...CORS_HEADERS,
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8'
  });
  response.end(text);
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
 */
function classifyError(error) {
  const message = error?.message || 'Internal server error';
  const code = error?.code || undefined;

  // Timeout errors → 504
  if (code === 'REQUEST_TIMEOUT' || error?.statusCode === 504) {
    return { status: 504, body: { error: message, code: 'REQUEST_TIMEOUT' } };
  }

  if (code === 'PAYLOAD_TOO_LARGE' || error?.statusCode === 413) {
    return { status: 413, body: { error: message, code: 'PAYLOAD_TOO_LARGE' } };
  }

  if (code === 'BAD_REQUEST' && error?.statusCode === 400) {
    return { status: 400, body: { error: message, code: 'BAD_REQUEST' } };
  }

  // Bad request patterns (missing/invalid parameters)
  if (/^Missing\b/i.test(message) || /^Unknown region/i.test(message) || /^Invalid\b/i.test(message)) {
    return { status: 400, body: { error: message, code: 'BAD_REQUEST' } };
  }

  // Default → 500
  return { status: 500, body: { error: message, code: code || 'INTERNAL_ERROR' } };
}

/**
 * Adapter: run a handler written for (req, res) using Node's http request/response.
 * Handlers use res.status(N).json(obj) — we shim that interface.
 */
async function runVercelHandler(handler, request, response, url) {
  // Read body for POST requests
  let bodyRaw = '';
  if (request.method === 'POST') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    bodyRaw = Buffer.concat(chunks).toString();
  }

  // Build a Vercel-compatible req object
  const req = {
    method: request.method,
    headers: request.headers,
    query: Object.fromEntries(url.searchParams),
    body: bodyRaw ? (() => { try { return JSON.parse(bodyRaw); } catch { return bodyRaw; } })() : undefined,
  };

  // Build a Vercel-compatible res object
  let statusCode = 200;
  const res = {
    setHeader: () => res,
    status: (code) => { statusCode = code; return res; },
    json: (data) => sendJson(response, statusCode, data),
    send: (data) => sendText(response, statusCode, typeof data === 'string' ? data : JSON.stringify(data)),
    end: (data) => { if (data) response.end(data); else response.end(); },
  };

  await handler(req, res);
}

/** Build the admin-health response from the local server's cached briefing */
async function buildAdminHealthResponse() {
  const briefingPayload = buildAdminHealthPayload(await getBriefing(), {
    timestamp: new Date().toISOString()
  });
  const healthPayload = await getHealth();

  return mergeAdminHealthPayloads(briefingPayload, {
    sourceHealth: healthPayload.sourceHealth,
    coverageMetrics: healthPayload.coverageMetrics,
    coverageDiagnostics: healthPayload.coverageDiagnostics
  });
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: 'Missing request URL' });
    return;
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, CORS_HEADERS);
    response.end();
    return;
  }

  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);

  try {
    // ── Stateful routes (use server's cache/SQLite) ──

    if (request.method === 'GET' && url.pathname === '/api/briefing') {
      const briefing = await withTimeout(() => getBriefing());
      const hasSnapshot = briefing.meta.fetchedAt || briefing.articles.length > 0;
      sendJson(response, hasSnapshot ? 200 : 503, briefing);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/events') {
      const briefing = await withTimeout(() => getBriefing());
      const hasSnapshot = briefing.meta.fetchedAt || briefing.events.length > 0;
      sendJson(response, hasSnapshot ? 200 : 503, {
        meta: briefing.meta,
        events: briefing.events,
        sourceHealth: briefing.sourceHealth,
        ingestHealth: briefing.ingestHealth
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      const health = await withTimeout(() => getHealth());
      health.circuitBreaker = getCircuitSummary();
      sendJson(response, 200, health);
      return;
    }

    // ── SSE: real-time event stream ──
    if (request.method === 'GET' && url.pathname === '/api/stream') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        ...CORS_HEADERS
      });
      response.write(': connected\n\n');
      addSseClient(response);
      request.on('close', () => removeSseClient(response));
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
      return withTimeout(() => runVercelHandler(sourceCatalogHandler, request, response, url));
    }

    if (request.method === 'GET' && url.pathname === '/api/source-catalog/state') {
      sendJson(response, 200, getSourceCatalogStatus());
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

    if (request.method === 'GET' && url.pathname === '/api/region-briefing') {
      const iso = (url.searchParams.get('iso') || '').trim().toUpperCase();
      if (!iso) { sendJson(response, 400, { error: 'Missing iso query parameter', code: 'BAD_REQUEST' }); return; }
      sendJson(response, 200, await withTimeout(() => getRegionBriefing(iso)));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/refresh') {
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
      if (password !== getAdminPassword()) {
        sendJson(response, 401, { error: 'Invalid password', code: 'UNAUTHORIZED' });
        return;
      }
      const token = createSessionToken();
      if (!token) {
        sendJson(response, 500, { error: 'Could not create session', code: 'INTERNAL_ERROR' });
        return;
      }
      const secure = isHttpsRequest(request);
      sendJsonWithCookies(response, 200, { ok: true }, [buildSetSessionCookie(token, secure)]);
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
      sendJsonWithCookies(response, 200, { ok: true }, [buildClearSessionCookie(secure)]);
      return;
    }

    // Legacy JSON check (no cookie) — used by some API clients
    if (request.method === 'POST' && url.pathname === '/api/admin-auth') {
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
      const password = body.password;
      if (String(password || '').trim() === getAdminPassword()) {
        return sendJson(response, 200, { ok: true });
      }
      return sendJson(response, 401, { error: 'Invalid password' });
    }

    if (url.pathname === '/api/gdelt-proxy') {
      return withTimeout(() => runVercelHandler(gdeltProxyHandler, request, response, url));
    }

    if (request.method === 'GET' && url.pathname === '/') {
      sendText(response, 200, 'Mapr backend is running.');
      return;
    }

    sendJson(response, 404, { error: 'Not found', code: 'NOT_FOUND' });
  } catch (error) {
    const { status, body } = classifyError(error);
    sendJson(response, status, body);
  }
});

// Start server FIRST so healthcheck passes, then initialize data in background
const HOST = process.env.HOST || '0.0.0.0';
log.info('mapr_server_starting', { host: HOST, port: PORT, databaseUrl: process.env.DATABASE_URL ? 'set' : 'not_set' });

server.listen(PORT, HOST, async () => {
  log.info('mapr_server_listening', { host: HOST, port: PORT });
  try {
    await initializeIngestion();
  } catch (err) {
    console.error('Ingestion initialization failed:', err.message);
    console.error(err.stack);
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

  // Keep-alive: self-ping every 4 minutes to prevent Railway from scaling to zero
  if (process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_ENVIRONMENT) {
    const keepAliveUrl = `http://127.0.0.1:${PORT}/api/health`;
    setInterval(() => {
      fetch(keepAliveUrl).catch(() => {});
    }, 4 * 60 * 1000);
    console.log('Keep-alive ping enabled (every 4 min).');
  }
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});

function shutdown() {
  stopScheduler();
  stopFlightTracking();
  stopShipTracking();
  server.close(() => {
    closeStorage();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
