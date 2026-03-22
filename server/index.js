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

// Import Vercel API handlers for stateless routes (no duplication)
import adminAuthHandler from '../api/admin-auth.js';
import gdeltProxyHandler from '../api/gdelt-proxy.js';
import sourceCatalogHandler from '../api/source-catalog.js';

const PORT = Number(process.env.PORT || process.env.MAPR_API_PORT || 3030);

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
      const briefing = await getBriefing();
      const hasSnapshot = briefing.meta.fetchedAt || briefing.articles.length > 0;
      sendJson(response, hasSnapshot ? 200 : 503, briefing);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/events') {
      const briefing = await getBriefing();
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
      sendJson(response, 200, await getHealth());
      return;
    }

    if ((request.method === 'GET' || request.method === 'POST') && url.pathname === '/api/source-catalog') {
      return runVercelHandler(sourceCatalogHandler, request, response, url);
    }

    if (request.method === 'GET' && url.pathname === '/api/source-catalog/state') {
      sendJson(response, 200, getSourceCatalogStatus());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/coverage-history') {
      const limit = Math.max(1, Math.min(24, Number(url.searchParams.get('limit') || 8)));
      const transitions = Math.max(1, Math.min(40, Number(url.searchParams.get('transitions') || 16)));
      sendJson(response, 200, getCoverageHistory(limit, transitions));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/coverage-region') {
      const iso = (url.searchParams.get('iso') || '').trim().toUpperCase();
      if (!iso) { sendJson(response, 400, { error: 'Missing iso query parameter' }); return; }
      const limit = Math.max(1, Math.min(24, Number(url.searchParams.get('limit') || 10)));
      const transitions = Math.max(1, Math.min(24, Number(url.searchParams.get('transitions') || 8)));
      sendJson(response, 200, getRegionCoverageHistory(iso, limit, transitions));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/region-briefing') {
      const iso = (url.searchParams.get('iso') || '').trim().toUpperCase();
      if (!iso) { sendJson(response, 400, { error: 'Missing iso query parameter' }); return; }
      sendJson(response, 200, await getRegionBriefing(iso));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/refresh') {
      const briefing = await refreshSnapshot({ force: true, reason: 'manual' });
      sendJson(response, 200, briefing);
      return;
    }

    // ── Admin health (uses server's cached data, but auth logic is shared) ──

    if (request.method === 'GET' && url.pathname === '/api/admin-health') {
      const authHeader = String(request.headers['x-admin-password'] || '').trim();
      const adminPw = String(process.env.ADMIN_PASSWORD || '').trim();
      if (!adminPw || authHeader !== adminPw) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      sendJson(response, 200, await buildAdminHealthResponse());
      return;
    }

    // ── Stateless routes (delegate to Vercel API handlers — no duplication) ──

    if (url.pathname === '/api/admin-auth') {
      return runVercelHandler(adminAuthHandler, request, response, url);
    }

    if (url.pathname === '/api/gdelt-proxy') {
      return runVercelHandler(gdeltProxyHandler, request, response, url);
    }

    if (request.method === 'GET' && url.pathname === '/') {
      sendText(response, 200, 'Mapr backend is running.');
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

// Start server FIRST so healthcheck passes, then initialize data in background
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, async () => {
  console.log(`Mapr backend listening on http://${HOST}:${PORT}`);
  try {
    await initializeIngestion();
    startScheduler();
    console.log('Ingestion initialized and scheduler started.');
  } catch (err) {
    console.error('Ingestion initialization failed:', err.message);
  }
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
