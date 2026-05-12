import {
  hydrateSourceCatalog,
  readSourceCatalog,
  readSourceState,
  summarizeSourceCatalog,
  writeSourceCatalog
} from '../server/sourceCatalog.js';
import { getSourceCatalogStorageInfo } from '../server/sourceCatalogStore.js';
import { isAdminAuthorized } from './_lib/adminAuth.js';
import { isPublicHttpUrl } from '../server/urlGuard.js';

function parseBody(body) {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }

  return body && typeof body === 'object' ? body : {};
}

function setHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  res.setHeader('Content-Type', 'application/json');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setHeaders(res);
    return res.status(204).end();
  }

  setHeaders(res);

  if (req.method === 'GET') {
    const [catalog, sourceState] = await Promise.all([
      readSourceCatalog(),
      readSourceState()
    ]);

    return res.status(200).json({
      storage: getSourceCatalogStorageInfo(),
      summary: summarizeSourceCatalog(catalog, sourceState),
      feeds: hydrateSourceCatalog(catalog, sourceState)
    });
  }

  if (req.method === 'POST') {
    if (!isAdminAuthorized(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = parseBody(req.body);
    if (!Array.isArray(body.feeds)) {
      return res.status(400).json({ error: 'Missing feeds array' });
    }
    // Defense-in-depth: even though the caller is admin-authenticated, never
    // allow an internal/loopback/metadata URL into the feed catalog.
    for (const feed of body.feeds) {
      if (!feed || typeof feed !== 'object' || !isPublicHttpUrl(feed.url)) {
        return res.status(400).json({ error: 'Feed URL must be a public http(s) URL', code: 'BAD_REQUEST' });
      }
    }

    const catalog = await writeSourceCatalog(body.feeds);
    const sourceState = await readSourceState();

    return res.status(200).json({
      storage: getSourceCatalogStorageInfo(),
      summary: summarizeSourceCatalog(catalog, sourceState),
      feeds: hydrateSourceCatalog(catalog, sourceState)
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
