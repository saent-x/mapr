const API_BASE = import.meta.env.VITE_MAPR_API_BASE || '/api';

async function parseJsonResponse(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return payload;
}

// Lazy import to avoid circular and to make this util work in non-React envs.
async function authHeader() {
  try {
    const mod = await import('./instantDb.js');
    const u = await mod.default?.getAuth?.();
    const token = u?.refresh_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.auth) {
    Object.assign(headers, await authHeader());
    delete options.auth;
  }
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    const message = payload?.error || `Backend request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.code = payload?.code;
    error.payload = payload;
    throw error;
  }

  return payload;
}

/** @returns {Promise<{ ok: boolean; status: number; data: object | null }>} */
export async function fetchBackendBriefingRaw() {
  const response = await fetch(`${API_BASE}/briefing`);
  const data = await parseJsonResponse(response);
  return { ok: response.ok, status: response.status, data };
}

/** @returns {Promise<{ ok: boolean; status: number; data: object | null }>} */
export async function refreshBackendBriefingRaw() {
  const response = await fetch(`${API_BASE}/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const data = await parseJsonResponse(response);
  return { ok: response.ok, status: response.status, data };
}

export function fetchBackendBriefing() {
  return request('/briefing');
}

export function refreshBackendBriefing() {
  return request('/refresh', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    }
  });
}

export function fetchBackendCoverageHistory({ limit = 8, transitions = 16 } = {}) {
  return request(`/coverage-history?limit=${limit}&transitions=${transitions}`);
}

export function fetchBackendCoverageHistoryWithRegions({ limit = 24, transitions = 16, topN = 20 } = {}) {
  return request(`/coverage-history?limit=${limit}&transitions=${transitions}&regions=1&topN=${topN}`);
}

export function fetchBackendCoverageRegion({ iso, limit = 10, transitions = 8 } = {}) {
  if (!iso) {
    throw new Error('Missing iso for region coverage request');
  }

  return request(`/coverage-region?iso=${encodeURIComponent(iso)}&limit=${limit}&transitions=${transitions}`);
}

export function fetchBackendRegionBriefing({ iso } = {}) {
  if (!iso) {
    throw new Error('Missing iso for region briefing request');
  }

  return request(`/region-briefing?iso=${encodeURIComponent(iso)}`);
}

export function fetchBackendHealth() {
  return request('/health');
}

export function fetchSnapshotHistory({ from, to, limit = 48 } = {}) {
  const params = new URLSearchParams();
  if (from) params.set('from', typeof from === 'number' ? new Date(from).toISOString() : from);
  if (to) params.set('to', typeof to === 'number' ? new Date(to).toISOString() : to);
  params.set('limit', String(limit));
  return request(`/snapshot-history?${params.toString()}`, { auth: true });
}

export function fetchSnapshotTimestamps({ from, to } = {}) {
  const params = new URLSearchParams();
  if (from) params.set('from', typeof from === 'number' ? new Date(from).toISOString() : from);
  if (to) params.set('to', typeof to === 'number' ? new Date(to).toISOString() : to);
  return request(`/snapshot-history/timestamps?${params.toString()}`, { auth: true });
}

export function listThreads({ status = 'active' } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  return request(`/threads?${params.toString()}`, { auth: true });
}

export function createThread({ title, seedEventId = null, seedArticleId = null } = {}) {
  return request('/threads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, seedEventId, seedArticleId }),
    auth: true,
  });
}

export function archiveThread(threadId) {
  return request(`/threads/${encodeURIComponent(threadId)}`, {
    method: 'DELETE',
    auth: true,
  });
}
