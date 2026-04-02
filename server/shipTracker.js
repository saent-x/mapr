/**
 * Ship Tracking Module — AISStream.io WebSocket API
 *
 * Maintains a WebSocket connection to wss://stream.aisstream.io/v0/stream
 * and caches vessel positions. Requires AISSTREAM_API_KEY env var.
 */

import { WebSocket } from 'ws';

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
const BATCH_INTERVAL_MS = 30_000;
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 120_000;

/** @type {Map<number, object>} */
const vesselCache = new Map();
let ws = null;
let reconnectTimer = null;
let reconnectDelay = RECONNECT_BASE_MS;
let batchTimer = null;
let staleSweepTimer = null;
let onBatchUpdate = null;

function evictStaleVessels() {
  const now = Date.now();
  for (const [key, v] of vesselCache) {
    if (v.lastUpdate && now - v.lastUpdate > STALE_THRESHOLD_MS) {
      vesselCache.delete(key);
    }
  }
}

function connect() {
  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) return;

  try {
    ws = new WebSocket(AISSTREAM_URL);

    ws.on('open', () => {
      console.log('[shipTracker] Connected to AISStream');
      reconnectDelay = RECONNECT_BASE_MS;

      const subscription = {
        APIKey: apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
      };
      ws.send(JSON.stringify(subscription));
    });

    ws.on('message', (raw) => {
      try {
        handleMessage(JSON.parse(raw.toString()));
      } catch { /* ignore parse errors */ }
    });

    ws.on('close', () => {
      console.log('[shipTracker] Connection closed, reconnecting...');
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.warn('[shipTracker] WebSocket error:', err.message);
      ws.close();
    });
  } catch (err) {
    console.warn('[shipTracker] Failed to connect:', err.message);
    scheduleReconnect();
  }
}

function handleMessage(msg) {
  if (msg.MessageType === 'PositionReport') {
    const d = msg.Message || msg;
    const meta = msg.MetaData || {};
    const mmsi = meta.MMSI || d.MMSI;
    if (!mmsi) return;

    const existing = vesselCache.get(mmsi) || {};
    vesselCache.set(mmsi, {
      ...existing,
      mmsi,
      name: meta.ShipName?.trim() || existing.name || '',
      lat: meta.Lat ?? d.Lat,
      lng: meta.Lon ?? d.Lon,
      speed: d.Sog ?? existing.speed ?? 0,
      heading: d.Cog ?? d.TrueHeading ?? existing.heading ?? 0,
      type: existing.type || null,
      destination: existing.destination || '',
      lastUpdate: Date.now(),
    });
  } else if (msg.MessageType === 'ShipStaticData') {
    const d = msg.Message || msg;
    const meta = msg.MetaData || {};
    const mmsi = meta.MMSI || d.MMSI;
    if (!mmsi) return;

    const existing = vesselCache.get(mmsi) || {};
    vesselCache.set(mmsi, {
      ...existing,
      mmsi,
      name: (d.Name || meta.ShipName || existing.name || '').trim(),
      type: d.Type ?? existing.type ?? null,
      destination: (d.Destination || existing.destination || '').trim(),
      lat: existing.lat ?? meta.Lat,
      lng: existing.lng ?? meta.Lon,
      speed: existing.speed ?? 0,
      heading: existing.heading ?? 0,
      lastUpdate: Date.now(),
    });
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    connect();
  }, reconnectDelay);
}

export function startBatchPush(callback) {
  onBatchUpdate = callback;
  if (batchTimer) return;
  batchTimer = setInterval(() => {
    if (onBatchUpdate) onBatchUpdate(getCachedVessels());
  }, BATCH_INTERVAL_MS);
}

export function startShipTracking() {
  if (!process.env.AISSTREAM_API_KEY) {
    console.log('[shipTracker] AISSTREAM_API_KEY not set, ship tracking disabled');
    return;
  }
  if (!staleSweepTimer) {
    staleSweepTimer = setInterval(evictStaleVessels, 60_000);
  }
  connect();
}

export function stopShipTracking() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (batchTimer) { clearInterval(batchTimer); batchTimer = null; }
  if (staleSweepTimer) { clearInterval(staleSweepTimer); staleSweepTimer = null; }
  onBatchUpdate = null;
  if (ws) { ws.close(); ws = null; }
}

export function getCachedVessels() {
  return Array.from(vesselCache.values()).map((v) => ({
    mmsi: v.mmsi,
    name: v.name,
    lat: v.lat,
    lng: v.lng,
    speed: v.speed,
    heading: v.heading,
    type: v.type,
    destination: v.destination,
    lastUpdate: v.lastUpdate,
  }));
}
