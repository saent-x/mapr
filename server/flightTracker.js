/**
 * Flight Tracking Module — OpenSky Network API
 *
 * Polls GET https://opensky-network.org/api/states/all every 2 minutes,
 * caches aircraft positions, and exposes them for the API layer.
 */

const OPENSKY_URL = 'https://opensky-network.org/api/states/all';
const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/** @type {Map<string, object>} */
const aircraftCache = new Map();
let pollTimer = null;
let lastPollTime = null;

const EMERGENCY_SQUAWKS = { '7500': 'hijack', '7600': 'comms-failure', '7700': 'emergency' };

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch(OPENSKY_URL, { signal: controller.signal });

    if (!resp.ok) {
      console.warn(`[flightTracker] OpenSky returned ${resp.status}`);
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

    for (const [key, ac] of aircraftCache) {
      if (now - (ac.lastContact * 1000 || 0) > STALE_THRESHOLD_MS) {
        aircraftCache.delete(key);
      }
    }

    lastPollTime = new Date().toISOString();
    console.log(`[flightTracker] Polled: ${data.states.length} states, ${aircraftCache.size} cached aircraft`);
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn('[flightTracker] Poll failed:', err.message);
    }
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
