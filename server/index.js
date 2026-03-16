import http from 'node:http';
import { closeStorage } from './storage.js';
import {
  getBriefing,
  getCoverageHistory,
  getRegionBriefing,
  getRegionCoverageHistory,
  getHealth,
  initializeIngestion,
  refreshSnapshot,
  startScheduler,
  stopScheduler
} from './ingest.js';

const PORT = Number(process.env.MAPR_API_PORT || 3030);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8'
  });
  response.end(text);
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: 'Missing request URL' });
    return;
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'Content-Type'
    });
    response.end();
    return;
  }

  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);

  try {
    if (request.method === 'GET' && url.pathname === '/api/briefing') {
      const briefing = getBriefing();
      const hasSnapshot = briefing.meta.fetchedAt || briefing.articles.length > 0;
      sendJson(response, hasSnapshot ? 200 : 503, briefing);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/events') {
      const briefing = getBriefing();
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

    if (request.method === 'GET' && url.pathname === '/api/coverage-history') {
      const limit = Math.max(1, Math.min(24, Number(url.searchParams.get('limit') || 8)));
      const transitions = Math.max(1, Math.min(40, Number(url.searchParams.get('transitions') || 16)));
      sendJson(response, 200, getCoverageHistory(limit, transitions));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/coverage-region') {
      const iso = (url.searchParams.get('iso') || '').trim().toUpperCase();
      if (!iso) {
        sendJson(response, 400, { error: 'Missing iso query parameter' });
        return;
      }

      const limit = Math.max(1, Math.min(24, Number(url.searchParams.get('limit') || 10)));
      const transitions = Math.max(1, Math.min(24, Number(url.searchParams.get('transitions') || 8)));
      sendJson(response, 200, getRegionCoverageHistory(iso, limit, transitions));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/region-briefing') {
      const iso = (url.searchParams.get('iso') || '').trim().toUpperCase();
      if (!iso) {
        sendJson(response, 400, { error: 'Missing iso query parameter' });
        return;
      }

      sendJson(response, 200, await getRegionBriefing(iso));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/refresh') {
      const briefing = await refreshSnapshot({ force: true, reason: 'manual' });
      sendJson(response, 200, briefing);
      return;
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

await initializeIngestion();
startScheduler();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mapr backend listening on http://127.0.0.1:${PORT}`);
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
