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

// Import Vercel API handlers for stateless routes (no duplication)
import adminAuthHandler from '../api/admin-auth.js';
import gdeltProxyHandler from '../api/gdelt-proxy.js';
import sourceCatalogHandler from '../api/source-catalog.js';

const PORT = Number(process.env.PORT || process.env.MAPR_API_PORT || 3030);
const API_TIMEOUT_MS = 30_000; // 30s timeout for API request handlers

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'Content-Type, X-Admin-Password',
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    ...CORS_HEADERS,
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
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

  // Bad request patterns (missing/invalid parameters)
  if (/^Missing\b/i.test(message) || /^Unknown region/i.test(message) || /^Invalid\b/i.test(message)) {
    return { status: 400, body: { error: message, code: 'BAD_REQUEST' } };
  }

  // Default → 500
  return { status: 500, body: { error: message, code: code || 'INTERNAL_ERROR' } };
}

/**
 * Adapter: run a Vercel-style handler (req, res) using Node's http request/response.
 * Vercel handlers use res.status(N).json(obj) — we shim that interface.
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
      const authHeader = String(request.headers['x-admin-password'] || '').trim();
      const adminPw = String(process.env.ADMIN_PASSWORD || '').trim();
      if (!adminPw || authHeader !== adminPw) { sendJson(response, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' }); return; }
      sendJson(response, 200, await withTimeout(() => buildAdminHealthResponse()));
      return;
    }

    // ── Stateless routes (delegate to Vercel API handlers — no duplication) ──

    if (url.pathname === '/api/admin-auth') {
      return withTimeout(() => runVercelHandler(adminAuthHandler, request, response, url));
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
console.log(`Starting Mapr backend on ${HOST}:${PORT}...`);
console.log(`DATABASE_URL: ${process.env.DATABASE_URL ? 'set (' + process.env.DATABASE_URL.slice(0, 30) + '...)' : 'NOT SET'}`);

server.listen(PORT, HOST, async () => {
  console.log(`Mapr backend listening on http://${HOST}:${PORT}`);
  try {
    await initializeIngestion();
    startScheduler();
    console.log('Ingestion initialized and scheduler started.');
  } catch (err) {
    console.error('Ingestion initialization failed:', err.message);
    console.error(err.stack);
  }

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
  server.close(() => {
    closeStorage();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
