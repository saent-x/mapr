import { useEffect, useRef, useState, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_MAPR_API_BASE || '/api';
const FLIGHT_POLL_MS = 90_000;
const VESSEL_POLL_MS = 45_000;
const INTERPOLATION_TICK_MS = 2_000;

/**
 * Lazy-fetches flight/vessel positions and interpolates between polls
 * so markers appear to move smoothly across the map.
 *
 * Returns { points, vesselsDisabled } where vesselsDisabled is true
 * when the server has no AISSTREAM_API_KEY configured.
 */
export default function useTrackingOverlayData(showFlights, showVessels) {
  const [points, setPoints] = useState([]);
  const [vesselsDisabled, setVesselsDisabled] = useState(false);
  const prevPositions = useRef(new Map());
  const latestData = useRef([]);

  const interpolate = useCallback(() => {
    const now = Date.now();
    const result = latestData.current.map((p) => {
      const prev = prevPositions.current.get(p.id);
      if (!prev || !p.velocity) return p;

      const elapsed = (now - prev.ts) / 1000;
      if (elapsed <= 0 || elapsed > 300) return p;

      const speed = p.velocity || 0;
      const hdg = (p.heading || 0) * (Math.PI / 180);
      const distDeg = (speed * elapsed) / 111_320;

      return {
        ...p,
        lat: p.lat + distDeg * Math.cos(hdg),
        lng: p.lng + distDeg * Math.sin(hdg) / Math.cos(p.lat * Math.PI / 180),
      };
    });
    setPoints(result);
  }, []);

  useEffect(() => {
    if (!showFlights && !showVessels) {
      setPoints([]);
      latestData.current = [];
      prevPositions.current.clear();
      return undefined;
    }

    let cancelled = false;

    async function load() {
      const next = [];
      if (showFlights) {
        try {
          const r = await fetch(`${API_BASE}/flights`);
          if (!r.ok) throw new Error(String(r.status));
          const d = await r.json();
          for (const ac of d.aircraft || []) {
            if (ac.lat == null || ac.lng == null) continue;
            next.push({
              id: `a-${ac.icao24}`,
              kind: 'air',
              lat: ac.lat,
              lng: ac.lng,
              heading: ac.heading ?? 0,
              altitude: ac.altitude,
              velocity: ac.velocity,
              verticalRate: ac.verticalRate,
              onGround: ac.onGround,
              emergency: ac.emergency,
              callsign: (ac.callsign || '').trim(),
              originCountry: ac.originCountry || '',
              label: (ac.callsign || ac.icao24 || '').trim() || ac.icao24,
            });
          }
        } catch (err) {
          console.warn('[useTrackingOverlayData] Failed to fetch flights:', err.message);
        }
      }
      if (showVessels) {
        try {
          const r = await fetch(`${API_BASE}/vessels`);
          if (!r.ok) throw new Error(String(r.status));
          const d = await r.json();
          if (d.enabled === false) {
            if (!cancelled) setVesselsDisabled(true);
          } else {
            if (!cancelled) setVesselsDisabled(false);
          }
          for (const v of d.vessels || []) {
            if (v.lat == null || v.lng == null) continue;
            next.push({
              id: `s-${v.mmsi}`,
              kind: 'sea',
              lat: v.lat,
              lng: v.lng,
              heading: v.heading ?? 0,
              speed: v.speed,
              label: (v.name || String(v.mmsi)).trim() || String(v.mmsi),
            });
          }
        } catch (err) {
          console.warn('[useTrackingOverlayData] Failed to fetch vessels:', err.message);
        }
      }

      if (cancelled) return;

      const now = Date.now();
      const newPrev = new Map();
      for (const p of next) {
        newPrev.set(p.id, { lat: p.lat, lng: p.lng, heading: p.heading, ts: now });
      }
      prevPositions.current = newPrev;
      latestData.current = next;
      setPoints(next);
    }

    load();
    const pollMs = showFlights ? FLIGHT_POLL_MS : VESSEL_POLL_MS;
    const pollId = setInterval(load, pollMs);

    const tickId = setInterval(() => {
      if (!cancelled && latestData.current.length > 0) {
        interpolate();
      }
    }, INTERPOLATION_TICK_MS);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      clearInterval(tickId);
    };
  }, [showFlights, showVessels, interpolate]);

  return { points, vesselsDisabled };
}
