import { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_MAPR_API_BASE || '/api';

/**
 * Lazy-fetches flight/vessel positions only when the corresponding overlay is enabled.
 * @param {boolean} showFlights
 * @param {boolean} showVessels
 */
export default function useTrackingOverlayData(showFlights, showVessels) {
  const [points, setPoints] = useState([]);

  useEffect(() => {
    if (!showFlights && !showVessels) {
      setPoints([]);
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
              label: (ac.callsign || ac.icao24 || '').trim() || ac.icao24,
            });
          }
        } catch {
          /* ignore */
        }
      }
      if (showVessels) {
        try {
          const r = await fetch(`${API_BASE}/vessels`);
          if (!r.ok) throw new Error(String(r.status));
          const d = await r.json();
          for (const v of d.vessels || []) {
            if (v.lat == null || v.lng == null) continue;
            next.push({
              id: `s-${v.mmsi}`,
              kind: 'sea',
              lat: v.lat,
              lng: v.lng,
              label: (v.name || String(v.mmsi)).trim() || String(v.mmsi),
            });
          }
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setPoints(next);
    }

    load();
    const intervalMs = showFlights ? 90_000 : 45_000;
    const id = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [showFlights, showVessels]);

  return points;
}
