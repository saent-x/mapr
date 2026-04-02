/**
 * Flight Tracking Module — OpenSky Network API
 *
 * Polls GET https://opensky-network.org/api/states/all every 2 minutes,
 * caches aircraft positions, and exposes them for the API layer.
 *
 * Supports authenticated access via OAuth2 client credentials
 * (env: OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET) for higher rate limits.
 */

import { isCircuitOpen, recordSuccess, recordFailure } from './circuitBreaker.js';

const OPENSKY_URL = 'https://opensky-network.org/api/states/all';
const OPENSKY_TOKEN_URL = 'https://opensky-network.org/auth/token';
const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 15_000;
const CIRCUIT_ID = 'opensky';

const EMERGENCY_SQUAWKS = { '7500': 'hijack', '7600': 'comms-failure', '7700': 'emergency' };

/** @type {Map<string, object>} */
const aircraftCache = new Map();
let pollTimer = null;
let lastPollTime = null;

// OAuth2 token cache
let accessToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  // Reuse token if still valid (with 60s buffer)
  if (accessToken && Date.now() < tokenExpiresAt - 60_000) {
    return accessToken;
  }

  try {
    const resp = await fetch(OPENSKY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!resp.ok) {
      console.warn(`[flightTracker] OAuth token request failed: ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    accessToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    console.log('[flightTracker] Obtained OAuth access token');
    return accessToken;
  } catch (err) {
    console.warn('[flightTracker] OAuth token error:', err.message);
    return null;
  }
}

function parseStateVector(s) {
  const squawk = s[14] || null;
  return {
    icao24: s[0],
    callsign: (s[1] || '').trim(),
    originCountry: s[2],
    lat: s[6],
    lng: s[5],
    altitude: s[7] ?? s[13],
    onGround: s[8],
    velocity: s[9],
    heading: s[10],
    verticalRate: s[11],
    squawk,
    emergency: squawk ? (EMERGENCY_SQUAWKS[squawk] || null) : null,
    category: s[17] || null,
    lastContact: s[4],
  };
}

async function pollAircraft() {
  if (isCircuitOpen(CIRCUIT_ID)) {
    console.log('[flightTracker] Circuit open, skipping poll');
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const headers = {};
    const token = await getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const resp = await fetch(OPENSKY_URL, { signal: controller.signal, headers });

    if (!resp.ok) {
      console.warn(`[flightTracker] OpenSky returned ${resp.status}`);
      recordFailure(CIRCUIT_ID);
      return;
    }

    const data = await resp.json();
    if (!data.states || !Array.isArray(data.states)) return;

    const now = Date.now();
    for (const s of data.states) {
      if (!s[0] || s[5] == null || s[6] == null) continue;
      const aircraft = parseStateVector(s);
      aircraftCache.set(aircraft.icao24, aircraft);
    }

    // Prune stale entries (separate pass for clarity)
    const staleKeys = [];
    for (const [key, ac] of aircraftCache) {
      if (now - (ac.lastContact * 1000 || 0) > STALE_THRESHOLD_MS) {
        staleKeys.push(key);
      }
    }
    for (const key of staleKeys) {
      aircraftCache.delete(key);
    }

    // Cap cache size — remove oldest entries if over limit
    if (aircraftCache.size > MAX_CACHE_SIZE) {
      const sorted = [...aircraftCache.entries()].sort(
        (a, b) => (a[1].lastContact || 0) - (b[1].lastContact || 0)
      );
      const toRemove = sorted.slice(0, aircraftCache.size - MAX_CACHE_SIZE);
      for (const [key] of toRemove) {
        aircraftCache.delete(key);
      }
    }

    recordSuccess(CIRCUIT_ID);
    lastPollTime = new Date().toISOString();
    console.log(`[flightTracker] Polled: ${data.states.length} states, ${aircraftCache.size} cached aircraft`);
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('[flightTracker] Poll timed out');
    } else {
      console.warn('[flightTracker] Poll failed:', err.message);
    }
    recordFailure(CIRCUIT_ID);
  } finally {
    clearTimeout(timeout);
  }
}

export function startFlightTracking() {
  if (pollTimer) return;
  console.log('[flightTracker] Starting OpenSky polling (every 2 min)...');
  pollAircraft();
  pollTimer = setInterval(pollAircraft, POLL_INTERVAL_MS);
}

export function stopFlightTracking() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function getCachedAircraft() {
  return Array.from(aircraftCache.values());
}

export function getLastPollTime() {
  return lastPollTime;
}
