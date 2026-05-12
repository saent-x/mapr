import { useEffect, useMemo } from 'react';
import { useMap } from '@/components/ui/map';

/* ──────────────────────────── component ──────────────────────────── */

const MapTracking = ({
  trackingPoints = [],
}) => {
  const { map, isLoaded, styleRevision } = useMap();

  /* ── tracking GeoJSON ── */
  const trackingGeoJson = useMemo(() => ({
    type: 'FeatureCollection',
    features: (trackingPoints || [])
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => ({
        type: 'Feature',
        properties: {
          id: p.id,
          kind: p.kind,
          label: p.label,
          heading: p.heading ?? 0,
          emergency: p.emergency || '',
          icon: p.kind === 'air' ? 'plane-icon' : 'ship-icon',
          color: p.emergency ? '#ff4444' : (p.kind === 'air' ? '#7ecbff' : '#44ddb0'),
        },
        geometry: {
          type: 'Point',
          coordinates: [p.lng, p.lat],
        },
      })),
  }), [trackingPoints]);

  /* ── register plane + ship icons ── */
  useEffect(() => {
    if (!isLoaded || !map) return undefined;

    // Register plane icon
    const planeSize = 16;
    const planeCanvas = document.createElement('canvas');
    planeCanvas.width = planeSize;
    planeCanvas.height = planeSize;
    const pCtx = planeCanvas.getContext('2d');
    pCtx.fillStyle = '#ffffff';
    const cx = planeSize / 2;
    pCtx.beginPath();
    pCtx.moveTo(cx, 1);
    pCtx.lineTo(cx + 6, 11);
    pCtx.lineTo(cx, 8);
    pCtx.lineTo(cx - 6, 11);
    pCtx.closePath();
    pCtx.fill();
    const planeImageData = pCtx.getImageData(0, 0, planeSize, planeSize);
    if (!map.hasImage('plane-icon')) {
      try { map.addImage('plane-icon', planeImageData, { sdf: true }); } catch { /* ignore */ }
    }

    // Register ship icon
    const shipSize = 10;
    const shipCanvas = document.createElement('canvas');
    shipCanvas.width = shipSize;
    shipCanvas.height = shipSize;
    const sCtx = shipCanvas.getContext('2d');
    sCtx.fillStyle = '#ffffff';
    const scx = shipSize / 2;
    sCtx.beginPath();
    sCtx.moveTo(scx, 1);
    sCtx.lineTo(shipSize - 1, scx);
    sCtx.lineTo(scx, shipSize - 1);
    sCtx.lineTo(1, scx);
    sCtx.closePath();
    sCtx.fill();
    const shipImageData = sCtx.getImageData(0, 0, shipSize, shipSize);
    if (!map.hasImage('ship-icon')) {
      try { map.addImage('ship-icon', shipImageData, { sdf: true }); } catch { /* ignore */ }
    }
    return undefined;
  }, [isLoaded, map, styleRevision]);

  /* ── tracking source + layers ── */
  useEffect(() => {
    if (!isLoaded || !map) return undefined;

    if (!map.getSource('tracking-markers')) {
      map.addSource('tracking-markers', { type: 'geojson', data: trackingGeoJson });
    }
    if (!map.getLayer('tracking-icons')) {
      map.addLayer({
        id: 'tracking-icons', type: 'symbol', source: 'tracking-markers',
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-size': [
            'interpolate', ['linear'], ['zoom'],
            2, 0.3,
            5, 0.55,
            8, 0.8,
            12, 1.2,
          ],
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': ['get', 'color'],
          'icon-opacity': [
            'interpolate', ['linear'], ['zoom'],
            2, 0.5,
            6, 0.85,
          ],
        },
      });
    }
    return () => {
      try {
        if (map.getLayer('tracking-icons')) map.removeLayer('tracking-icons');
        if (map.getSource('tracking-markers')) map.removeSource('tracking-markers');
      } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map, styleRevision]);

  useEffect(() => {
    if (!isLoaded || !map) return;
    const src = map.getSource('tracking-markers');
    if (src) src.setData(trackingGeoJson);
  }, [isLoaded, map, trackingGeoJson, styleRevision]);

  return null;
};

export default MapTracking;
