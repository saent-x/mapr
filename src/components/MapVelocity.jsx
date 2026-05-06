import { useEffect, useMemo } from 'react';
import { useMap } from '@/components/ui/map';

/* ──────────────────────────── constants ──────────────────────────── */

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

/* ──────────────────────────── component ──────────────────────────── */

const MapVelocity = ({
  velocitySpikes = [],
  newsList,
}) => {
  const { map, isLoaded } = useMap();

  /* ── spike border filter/paint ── */
  const spikeIsos = useMemo(() => velocitySpikes.map((s) => s.iso), [velocitySpikes]);

  const spikeBorderFilter = useMemo(() => {
    if (spikeIsos.length === 0) return ['==', 1, 0];
    return ['in', ['get', '_iso'], ['literal', spikeIsos]];
  }, [spikeIsos]);

  const spikeBorderPaint = useMemo(() => {
    const matchEntries = [];
    for (const spike of velocitySpikes) {
      matchEntries.push(spike.iso, spike.level === 'spike' ? 'rgba(255, 85, 119, 0.6)' : 'rgba(255, 170, 51, 0.5)');
    }
    const colorExpr = matchEntries.length > 0
      ? ['match', ['get', '_iso'], ...matchEntries, 'rgba(255, 170, 51, 0.3)']
      : 'rgba(255, 170, 51, 0.3)';
    return {
      'line-color': colorExpr,
      'line-width': 2,
      'line-blur': 1.5,
    };
  }, [velocitySpikes]);

  /* ── velocity spikes GeoJSON ── */
  const velocitySpikesGeoJson = useMemo(() => {
    if (velocitySpikes.length === 0) return EMPTY_FC;
    const isoToStory = {};
    for (const story of newsList) {
      if (!story.isoA2 || !story.coordinates) continue;
      if (!isoToStory[story.isoA2] || story.severity > isoToStory[story.isoA2].severity) {
        isoToStory[story.isoA2] = story;
      }
    }
    const features = [];
    for (const spike of velocitySpikes.slice(0, 10)) {
      const story = isoToStory[spike.iso];
      if (!story) continue;
      features.push({
        type: 'Feature',
        properties: {
          iso: spike.iso,
          level: spike.level,
          zScore: spike.zScore === Infinity ? 99 : spike.zScore,
          color: spike.level === 'spike' ? '#ff5577' : '#ffaa33',
        },
        geometry: {
          type: 'Point',
          coordinates: [story.coordinates[1], story.coordinates[0]],
        },
      });
    }
    return { type: 'FeatureCollection', features };
  }, [velocitySpikes, newsList]);

  /* ── spike border layer ── */
  useEffect(() => {
    if (!isLoaded || !map) return undefined;

    if (!map.getLayer('country-spike-border')) {
      map.addLayer({
        id: 'country-spike-border',
        type: 'line',
        source: 'countries',
        filter: spikeBorderFilter,
        paint: spikeBorderPaint,
      });
    }

    return () => {
      try {
        if (map.getLayer('country-spike-border')) map.removeLayer('country-spike-border');
      } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map]);

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer('country-spike-border')) return;
    try { map.setFilter('country-spike-border', spikeBorderFilter); } catch { /* ignore */ }
    for (const [key, value] of Object.entries(spikeBorderPaint)) {
      try { map.setPaintProperty('country-spike-border', key, value); } catch { /* ignore */ }
    }
  }, [isLoaded, map, spikeBorderFilter, spikeBorderPaint]);

  /* ── velocity spike markers source + layers ── */
  useEffect(() => {
    if (!isLoaded || !map) return undefined;

    if (!map.getSource('velocity-spikes')) {
      map.addSource('velocity-spikes', { type: 'geojson', data: velocitySpikesGeoJson });
    }
    if (!map.getLayer('velocity-spike-glow')) {
      map.addLayer({
        id: 'velocity-spike-glow', type: 'circle', source: 'velocity-spikes',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['get', 'zScore'], 1.5, 14, 3, 20, 5, 28],
          'circle-opacity': 0.08,
          'circle-blur': 1.2,
        },
      });
    }
    if (!map.getLayer('velocity-spike-ring')) {
      map.addLayer({
        id: 'velocity-spike-ring', type: 'circle', source: 'velocity-spikes',
        paint: {
          'circle-color': 'transparent',
          'circle-radius': ['interpolate', ['linear'], ['get', 'zScore'], 1.5, 9, 3, 13, 5, 18],
          'circle-opacity': 0,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-opacity': 0.55,
        },
      });
    }
    if (!map.getLayer('velocity-spike-dot')) {
      map.addLayer({
        id: 'velocity-spike-dot', type: 'circle', source: 'velocity-spikes',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 3,
          'circle-opacity': 0.9,
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(0,0,0,0.4)',
        },
      });
    }
    return () => {
      try {
        if (map.getLayer('velocity-spike-dot')) map.removeLayer('velocity-spike-dot');
        if (map.getLayer('velocity-spike-ring')) map.removeLayer('velocity-spike-ring');
        if (map.getLayer('velocity-spike-glow')) map.removeLayer('velocity-spike-glow');
        if (map.getSource('velocity-spikes')) map.removeSource('velocity-spikes');
      } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map]);

  useEffect(() => {
    if (!isLoaded || !map) return;
    const src = map.getSource('velocity-spikes');
    if (src) src.setData(velocitySpikesGeoJson);
  }, [isLoaded, map, velocitySpikesGeoJson]);

  return null;
};

export default MapVelocity;
