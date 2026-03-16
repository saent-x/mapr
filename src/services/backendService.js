const API_BASE = import.meta.env.VITE_MAPR_API_BASE || '/api';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.error || `Backend request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
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
