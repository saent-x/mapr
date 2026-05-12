import { useEffect, useMemo, useState } from 'react';
import { useMap } from '@/components/ui/map';
import { areCountriesAdjacent } from '../utils/geocoder';
import {
  buildCountryCoOccurrences,
  buildGeopoliticalArcData,
  coOccurrenceToStroke,
  coOccurrenceToColor,
  buildCountryStoryMap,
} from '../utils/geopoliticalArcs';
import { ARC_COLORS, CAUSAL_PAIRS, normalizeCausalCategory } from './MapConstants';
import { HIGH_FREQUENCY_ENTITIES } from '../utils/geopoliticalArcs';

/* ──────────────────────────── constants ──────────────────────────── */

const EMPTY_FC = { type: 'FeatureCollection', features: [] };
const ARC_HOVER_COLOR = '#2d8a94';

/* ──────────────────────────── component ──────────────────────────── */

const MapArcs = ({
  newsList,
  mapOverlay,
  hoveredArcId = null,
}) => {
  const { map, isLoaded, styleRevision } = useMap();

  /* ── arcs GeoJSON ── */
  const arcsGeoJson = useMemo(() => {
    const features = [];
    const seen = new Set();

    const countryStoryMap = {};
    for (const story of newsList) {
      if (!story.coordinates || !story.isoA2) continue;
      if (!countryStoryMap[story.isoA2] || story.severity > countryStoryMap[story.isoA2].severity) {
        countryStoryMap[story.isoA2] = story;
      }
    }

    const addArc = (isoA, isoB, severity, category, title, type = 'same-event', label = null) => {
      if (isoA === isoB) return;
      const pairKey = [isoA, isoB].sort().join('-');
      if (seen.has(pairKey)) return;
      const a = countryStoryMap[isoA];
      const b = countryStoryMap[isoB];
      if (!a || !b) return;
      seen.add(pairKey);
      const sev = severity ?? Math.round((a.severity + b.severity) / 2);
      features.push({
        type: 'Feature',
        properties: {
          severity: sev,
          color: ARC_COLORS[type] || ARC_COLORS['same-event'],
          arcType: type,
          arcLabel: label || '',
          category: category || a.category || b.category || 'related',
          startIso: isoA,
          endIso: isoB,
          startRegion: a.region || a.locality || isoA,
          endRegion: b.region || b.locality || isoB,
          title: title || a.title,
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [a.coordinates[1], a.coordinates[0]],
            [b.coordinates[1], b.coordinates[0]],
          ],
        },
      });
    };

    for (const story of newsList) {
      const eventCountries = story.countries;
      if (!Array.isArray(eventCountries) || eventCountries.length < 2) continue;
      for (let i = 0; i < eventCountries.length; i++) {
        for (let j = i + 1; j < eventCountries.length; j++) {
          addArc(eventCountries[i], eventCountries[j], story.severity, story.category, story.title, 'same-event');
        }
      }
    }

    const entityCountryMap = {};
    for (const story of newsList) {
      if (!story.isoA2) continue;
      for (const org of (story.entities?.organizations || [])) {
        if (!org.name) continue;
        // Skip global IOs/NGOs that show up everywhere — drawing a "shared-actor"
        // arc between two countries because both mention "UN" or "Reuters" is
        // noise, not signal. Same denylist that geopoliticalArcs.js uses.
        if (HIGH_FREQUENCY_ENTITIES.has(org.name)) continue;
        if (!entityCountryMap[org.name]) entityCountryMap[org.name] = [];
        entityCountryMap[org.name].push({ iso: story.isoA2, severity: story.severity, title: story.title });
      }
    }
    for (const [entityName, occurrences] of Object.entries(entityCountryMap)) {
      const uniqueCountries = [...new Set(occurrences.map((o) => o.iso))];
      if (uniqueCountries.length >= 2) {
        const maxSev = Math.max(...occurrences.map((o) => o.severity || 0));
        addArc(uniqueCountries[0], uniqueCountries[1], maxSev, 'shared-actor', entityName, 'shared-actor', entityName);
      }
    }

    const categoryCountryMap = {};
    for (const story of newsList) {
      if (!story.isoA2) continue;
      const normalizedCat = normalizeCausalCategory(story.category);
      if (!normalizedCat) continue;
      if (!categoryCountryMap[normalizedCat]) categoryCountryMap[normalizedCat] = [];
      categoryCountryMap[normalizedCat].push({ iso: story.isoA2, severity: story.severity, title: story.title });
    }
    for (const { source, target, label } of CAUSAL_PAIRS) {
      const sourceEntries = categoryCountryMap[source] || [];
      const targetEntries = categoryCountryMap[target] || [];
      for (const src of sourceEntries) {
        for (const tgt of targetEntries) {
          if (src.iso === tgt.iso) continue;
          if (!areCountriesAdjacent(src.iso, tgt.iso)) continue;
          const avgSev = Math.round(((src.severity || 0) + (tgt.severity || 0)) / 2);
          addArc(src.iso, tgt.iso, avgSev, label, `${src.title} → ${tgt.title}`, 'category-cooccurrence', label);
        }
      }
    }

    features.sort((a, b) => b.properties.severity - a.properties.severity);
    return { type: 'FeatureCollection', features: features.slice(0, 30) };
  }, [newsList]);

  /* ── geopolitical arcs GeoJSON ── */
  const geoArcsGeoJson = useMemo(() => {
    if (mapOverlay !== 'geopolitical') return EMPTY_FC;
    const coOccurrences = buildCountryCoOccurrences(newsList);
    const storyMap = buildCountryStoryMap(newsList);
    const arcData = buildGeopoliticalArcData(coOccurrences, storyMap);
    const maxCount = arcData.length > 0 ? arcData[0].count : 1;

    const features = arcData.map((arc) => ({
      type: 'Feature',
      properties: {
        startIso: arc.startIso,
        endIso: arc.endIso,
        startRegion: arc.startRegion,
        endRegion: arc.endRegion,
        count: arc.count,
        maxSeverity: arc.maxSeverity,
        avgSeverity: arc.avgSeverity,
        color: coOccurrenceToColor(arc.count, maxCount),
        strokeWidth: coOccurrenceToStroke(arc.count, maxCount),
        arcType: 'geopolitical',
        arcLabel: '',
        severity: arc.avgSeverity,
        category: 'geopolitical',
        title: '',
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [arc.startLng, arc.startLat],
          [arc.endLng, arc.endLat],
        ],
      },
    }));

    return { type: 'FeatureCollection', features };
  }, [newsList, mapOverlay]);

  const activeArcsGeoJson = mapOverlay === 'geopolitical' ? geoArcsGeoJson : arcsGeoJson;

  /* ── arcs source + layers ── */
  useEffect(() => {
    if (!isLoaded || !map) return undefined;

    if (!map.getSource('arcs')) {
      map.addSource('arcs', { type: 'geojson', data: activeArcsGeoJson });
    }

    const glowPaint = mapOverlay === 'geopolitical' ? {
      'line-color': ['get', 'color'],
      'line-width': ['get', 'strokeWidth'],
      'line-opacity': 0.12,
      'line-blur': 6,
    } : {
      'line-color': ['get', 'color'],
      'line-width': [
        'interpolate', ['linear'], ['get', 'severity'],
        20, 2,
        50, 3,
        85, 5,
      ],
      'line-opacity': [
        'interpolate', ['linear'], ['get', 'severity'],
        20, 0.03,
        50, 0.05,
        85, 0.08,
      ],
      'line-blur': 4,
    };

    const linePaint = mapOverlay === 'geopolitical' ? {
      'line-color': ['get', 'color'],
      'line-width': ['coalesce', ['get', 'strokeWidth'], 1],
      'line-opacity': 0.55,
    } : {
      'line-color': ['get', 'color'],
      'line-width': [
        'interpolate', ['linear'], ['get', 'severity'],
        20, 0.4,
        50, 0.5,
        85, 0.8,
      ],
      'line-opacity': [
        'interpolate', ['linear'], ['get', 'severity'],
        20, 0.1,
        50, 0.16,
        85, 0.25,
      ],
    };

    if (!map.getLayer('arc-glow')) {
      map.addLayer({ id: 'arc-glow', type: 'line', source: 'arcs', paint: glowPaint });
    }
    if (!map.getLayer('arc-lines')) {
      map.addLayer({
        id: 'arc-lines', type: 'line', source: 'arcs',
        layout: { 'line-cap': 'round' },
        paint: linePaint,
      });
    }
    if (!map.getLayer('arc-hover')) {
      map.addLayer({
        id: 'arc-hover', type: 'line', source: 'arcs',
        filter: ['==', 1, 0],
        paint: {
          'line-color': ARC_HOVER_COLOR,
          'line-width': 2,
          'line-opacity': 0.7,
        },
      });
    }

    return () => {
      try {
        if (map.getLayer('arc-hover')) map.removeLayer('arc-hover');
        if (map.getLayer('arc-lines')) map.removeLayer('arc-lines');
        if (map.getLayer('arc-glow')) map.removeLayer('arc-glow');
        if (map.getSource('arcs')) map.removeSource('arcs');
      } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map, styleRevision]);

  /* ── update arc data ── */
  useEffect(() => {
    if (!isLoaded || !map) return;
    const src = map.getSource('arcs');
    if (src) src.setData(activeArcsGeoJson);
  }, [isLoaded, map, activeArcsGeoJson, styleRevision]);

  /* ── update arc paint when overlay mode changes ── */
  useEffect(() => {
    if (!isLoaded || !map) return;
    if (!map.getLayer('arc-glow') || !map.getLayer('arc-lines')) return;

    const glowPaint = mapOverlay === 'geopolitical' ? {
      'line-color': ['get', 'color'],
      'line-width': ['get', 'strokeWidth'],
      'line-opacity': 0.12,
      'line-blur': 6,
    } : {
      'line-color': ['get', 'color'],
      'line-width': [
        'interpolate', ['linear'], ['get', 'severity'],
        20, 2,
        50, 3,
        85, 5,
      ],
      'line-opacity': [
        'interpolate', ['linear'], ['get', 'severity'],
        20, 0.03,
        50, 0.05,
        85, 0.08,
      ],
      'line-blur': 4,
    };

    const linePaint = mapOverlay === 'geopolitical' ? {
      'line-color': ['get', 'color'],
      'line-width': ['coalesce', ['get', 'strokeWidth'], 1],
      'line-opacity': 0.55,
    } : {
      'line-color': ['get', 'color'],
      'line-width': [
        'interpolate', ['linear'], ['get', 'severity'],
        20, 0.4,
        50, 0.5,
        85, 0.8,
      ],
      'line-opacity': [
        'interpolate', ['linear'], ['get', 'severity'],
        20, 0.1,
        50, 0.16,
        85, 0.25,
      ],
    };

    for (const [k, v] of Object.entries(glowPaint)) {
      try { map.setPaintProperty('arc-glow', k, v); } catch { /* ignore */ }
    }
    for (const [k, v] of Object.entries(linePaint)) {
      try { map.setPaintProperty('arc-lines', k, v); } catch { /* ignore */ }
    }
  }, [isLoaded, map, mapOverlay, styleRevision]);

  /* ── arc pulses source + layers ── */
  const [arcPulses, setArcPulses] = useState(EMPTY_FC);

  useEffect(() => {
    if (!isLoaded || !map) return undefined;

    if (!map.getSource('arc-pulses')) {
      map.addSource('arc-pulses', { type: 'geojson', data: arcPulses });
    }
    if (!map.getLayer('arc-pulse-glow')) {
      map.addLayer({
        id: 'arc-pulse-glow', type: 'circle', source: 'arc-pulses',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 5,
          'circle-opacity': 0.15,
          'circle-blur': 1,
        },
      });
    }
    if (!map.getLayer('arc-pulse-dot')) {
      map.addLayer({
        id: 'arc-pulse-dot', type: 'circle', source: 'arc-pulses',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 2,
          'circle-opacity': 0.6,
        },
      });
    }

    return () => {
      try {
        if (map.getLayer('arc-pulse-dot')) map.removeLayer('arc-pulse-dot');
        if (map.getLayer('arc-pulse-glow')) map.removeLayer('arc-pulse-glow');
        if (map.getSource('arc-pulses')) map.removeSource('arc-pulses');
      } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map, styleRevision]);

  useEffect(() => {
    if (!isLoaded || !map) return;
    const src = map.getSource('arc-pulses');
    if (src) src.setData(arcPulses);
  }, [isLoaded, map, arcPulses, styleRevision]);

  /* ── arc pulse animation ── */
  useEffect(() => {
    if (!isLoaded || !map) return undefined;
    if (hoveredArcId) return undefined;
    const lines = arcsGeoJson.features;
    if (lines.length === 0) return undefined;

    let frame = null;
    let t = 0;
    let lastUpdateTime = 0;

    const isVisible = () =>
      typeof document === 'undefined' || document.visibilityState === 'visible';

    const animate = (now) => {
      if (!isVisible()) {
        frame = null;
        return;
      }
      t = (t + 0.003) % 1;
      const points = [];
      for (let i = 0; i < lines.length; i++) {
        const coords = lines[i].geometry.coordinates;
        const props = lines[i].properties;
        const offset = (t + i * 0.13) % 1;
        const lng = coords[0][0] + (coords[1][0] - coords[0][0]) * offset;
        const lat = coords[0][1] + (coords[1][1] - coords[0][1]) * offset;
        points.push({
          type: 'Feature',
          properties: { color: props.color, severity: props.severity },
          geometry: { type: 'Point', coordinates: [lng, lat] },
        });
      }
      if (now - lastUpdateTime >= 100) {
        setArcPulses({ type: 'FeatureCollection', features: points });
        lastUpdateTime = now;
      }
      frame = requestAnimationFrame(animate);
    };

    const start = () => {
      if (frame == null && isVisible()) {
        lastUpdateTime = 0;
        frame = requestAnimationFrame(animate);
      }
    };
    const stop = () => {
      if (frame != null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
    };
    const onVisibility = () => {
      if (isVisible()) start();
      else stop();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    start();

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      stop();
    };
  }, [isLoaded, map, arcsGeoJson, hoveredArcId, styleRevision]);

  return null;
};

export default MapArcs;
