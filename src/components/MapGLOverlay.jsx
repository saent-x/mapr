import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMap, MapPopup } from '@/components/ui/map';
import countriesUrl from '../assets/ne_110m_admin_0_countries.geojson?url';
import { getSeverityMeta } from '../utils/mockData';
import { getCoverageMeta } from '../utils/coverageMeta';
import { areCountriesAdjacent } from '../utils/geocoder';
import { getStatesByIso } from '../utils/statesData';
import {
  buildCountryCoOccurrences,
  buildGeopoliticalArcData,
  coOccurrenceToStroke,
  coOccurrenceToColor,
  buildCountryStoryMap,
} from '../utils/geopoliticalArcs';

/* ──────────────────────────── constants (copied verbatim from FlatMap) ──────────────────────────── */

const ARC_COLORS = {
  'same-event': '#ffffff',
  'shared-actor': '#00d4ff',
  'causal-flow': '#ffaa00',
};

const CAUSAL_PAIRS = [
  { source: 'disaster', target: 'humanitarian', label: 'displacement' },
  { source: 'conflict', target: 'humanitarian', label: 'refugee flow' },
  { source: 'conflict', target: 'political', label: 'diplomatic response' },
  { source: 'economic', target: 'political', label: 'economic pressure' },
  { source: 'political', target: 'conflict', label: 'escalation' },
];

const normalizeCausalCategory = (cat) => {
  if (!cat) return null;
  const c = cat.toLowerCase();
  if (c.includes('seismic') || c.includes('weather') || c.includes('natural')) return 'disaster';
  if (c.includes('civil') || c.includes('politic')) return 'political';
  if (c.includes('conflict') || c.includes('war') || c.includes('military')) return 'conflict';
  if (c.includes('humanit') || c.includes('refugee') || c.includes('aid')) return 'humanitarian';
  if (c.includes('econom') || c.includes('trade') || c.includes('finance')) return 'economic';
  return c;
};

const getIso = (f) => {
  const iso = f?.properties?.ISO_A2;
  if (iso && iso !== '-99') return iso;
  return f?.properties?.WB_A2 || f?.properties?.ADM0_A3_US || null;
};

const SEVERITY_COLORS = [
  [85, '#ff3b5c'],
  [60, '#ff8a3d'],
  [35, '#ffc93e'],
  [0, '#3ee8b0'],
];

const severityToColor = (sev) => {
  for (const [threshold, color] of SEVERITY_COLORS) {
    if (sev >= threshold) return color;
  }
  return '#3ee8b0';
};

/* ──────────────────────────── component ──────────────────────────── */

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

const MapGLOverlay = ({
  newsList,
  regionSeverities,
  mapOverlay,
  coverageStatusByIso = {},
  velocitySpikes = [],
  trackingPoints = [],
  selectedRegion,
  selectedStory,
  onRegionSelect,
  onStorySelect,
  onArcSelect,
  surface = 'flat',
  drillIsos = null,
}) => {
  const { map, isLoaded } = useMap();
  const [countries, setCountries] = useState(null);
  const hoveredIsoRef = useRef(null);
  const prevSelectedRef = useRef(null);
  const [hoveredArcId, setHoveredArcId] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [popupInfo, setPopupInfo] = useState(null);
  const [theme, setTheme] = useState(() =>
    (typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null) || 'dark',
  );

  const isLight = theme === 'light';

  /* ── theme observer ── */
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute('data-theme') || 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  /* ── fetch countries GeoJSON ── */
  useEffect(() => {
    let mounted = true;
    fetch(countriesUrl)
      .then((r) => r.json())
      .then((geojson) => {
        if (!mounted) return;
        const processed = {
          ...geojson,
          features: geojson.features.map((f) => ({
            ...f,
            properties: {
              ...f.properties,
              _iso: getIso(f) || '',
              _name: f.properties.NAME || f.properties.ADMIN || '',
            },
          })),
        };
        setCountries(processed);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  /* ──────────────────────────── memoized paint/data ──────────────────────────── */

  const countryFillPaint = useMemo(() => {
    if (mapOverlay === 'coverage') {
      const matchEntries = [];
      for (const [iso, entry] of Object.entries(coverageStatusByIso)) {
        const meta = getCoverageMeta(entry?.status || 'uncovered');
        matchEntries.push(iso, meta.accent);
      }
      const colorExpr = matchEntries.length > 0
        ? ['match', ['get', '_iso'], ...matchEntries, 'rgba(255,255,255,0.02)']
        : 'rgba(255,255,255,0.02)';

      return {
        'fill-color': colorExpr,
        'fill-opacity': [
          'case',
          ...(drillIsos ? [
            ['!', ['in', ['get', '_iso'], ['literal', [...drillIsos]]]],
            0.015,
          ] : []),
          ['boolean', ['feature-state', 'selected'], false],
          0.42,
          ['boolean', ['feature-state', 'hover'], false],
          0.3,
          0.15,
        ],
      };
    }

    const matchEntries = [];
    for (const [iso, entry] of Object.entries(regionSeverities)) {
      matchEntries.push(iso, severityToColor(entry.peakSeverity));
    }
    const colorExpr = matchEntries.length > 0
      ? ['match', ['get', '_iso'], ...matchEntries, 'rgba(0, 200, 255, 0.03)']
      : 'rgba(0, 200, 255, 0.03)';

    return {
      'fill-color': colorExpr,
      'fill-opacity': [
        'case',
        ...(drillIsos ? [
          ['!', ['in', ['get', '_iso'], ['literal', [...drillIsos]]]],
          0.015,
        ] : []),
        ['boolean', ['feature-state', 'selected'], false],
        0.45,
        ['boolean', ['feature-state', 'hover'], false],
        0.35,
        ...(Object.keys(regionSeverities).length > 0 ? [
          ['in', ['get', '_iso'], ['literal', Object.keys(regionSeverities)]],
          0.2,
        ] : []),
        0.03,
      ],
    };
  }, [regionSeverities, mapOverlay, coverageStatusByIso, drillIsos]);

  const countryLinePaint = useMemo(() => {
    const selectedExpr = selectedRegion
      ? ['==', ['get', '_iso'], selectedRegion]
      : false;

    return {
      'line-color': [
        'case',
        ...(selectedExpr ? [selectedExpr, '#00d4ff'] : []),
        ['boolean', ['feature-state', 'hover'], false],
        'rgba(0, 240, 255, 0.5)',
        'rgba(0, 200, 255, 0.06)',
      ],
      'line-width': [
        'case',
        ...(selectedExpr ? [selectedExpr, 2] : []),
        ['boolean', ['feature-state', 'hover'], false],
        1.5,
        0.5,
      ],
    };
  }, [selectedRegion]);

  const selectedGlowPaint = useMemo(() => {
    if (!selectedRegion) {
      return { 'line-color': 'transparent', 'line-width': 0 };
    }
    return {
      'line-color': 'rgba(0, 212, 255, 0.25)',
      'line-width': 5,
      'line-blur': 4,
    };
  }, [selectedRegion]);

  const selectedGlowFilter = useMemo(() => {
    return selectedRegion ? ['==', ['get', '_iso'], String(selectedRegion)] : ['==', 1, 0];
  }, [selectedRegion]);

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

  const articlesGeoJson = useMemo(() => ({
    type: 'FeatureCollection',
    features: newsList
      .filter((s) => s.coordinates && s.coordinates.length >= 2
        && !(s.coordinates[0] === 0 && s.coordinates[1] === 0))
      .map((story) => ({
        type: 'Feature',
        properties: {
          id: story.id,
          title: story.title,
          severity: story.severity,
          articleCount: story.articleCount || 1,
          color: severityToColor(story.severity),
          locality: story.locality || '',
          category: story.category || '',
          isoA2: story.isoA2 || '',
        },
        geometry: {
          type: 'Point',
          coordinates: [story.coordinates[1], story.coordinates[0]],
        },
      })),
  }), [newsList]);

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

  const localityLabelsGeoJson = useMemo(() => {
    if (surface !== 'flat' || !selectedRegion) return EMPTY_FC;
    const states = getStatesByIso(selectedRegion);
    const features = states.map((c) => ({
      type: 'Feature',
      properties: { name: c.name },
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
    }));
    return { type: 'FeatureCollection', features };
  }, [selectedRegion, surface]);

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

  const selectedStoryGeoJson = useMemo(() => {
    if (!selectedStory || !selectedStory.coordinates) return EMPTY_FC;
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { id: selectedStory.id },
        geometry: {
          type: 'Point',
          coordinates: [selectedStory.coordinates[1], selectedStory.coordinates[0]],
        },
      }],
    };
  }, [selectedStory]);

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
          addArc(src.iso, tgt.iso, avgSev, label, `${src.title} → ${tgt.title}`, 'causal-flow', label);
        }
      }
    }

    features.sort((a, b) => b.properties.severity - a.properties.severity);
    return { type: 'FeatureCollection', features: features.slice(0, 30) };
  }, [newsList]);

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

  /* ──────────────────────────── imperative layer setup ──────────────────────────── */

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
  }, [isLoaded, map]);

  /* ── countries: source + layers mounted once (preserves feature-state) ── */
  useEffect(() => {
    if (!isLoaded || !map) return undefined;

    if (!map.getSource('countries')) {
      map.addSource('countries', {
        type: 'geojson',
        data: EMPTY_FC,
        promoteId: '_iso',
      });
    }

    if (!map.getLayer('country-fill')) {
      map.addLayer({ id: 'country-fill', type: 'fill', source: 'countries', paint: countryFillPaint });
    }
    if (!map.getLayer('country-border')) {
      map.addLayer({ id: 'country-border', type: 'line', source: 'countries', paint: countryLinePaint });
    }
    if (!map.getLayer('country-selected-glow')) {
      map.addLayer({
        id: 'country-selected-glow',
        type: 'line',
        source: 'countries',
        filter: selectedGlowFilter,
        paint: selectedGlowPaint,
      });
    }
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
        if (map.getLayer('country-selected-glow')) map.removeLayer('country-selected-glow');
        if (map.getLayer('country-border')) map.removeLayer('country-border');
        if (map.getLayer('country-fill')) map.removeLayer('country-fill');
        if (map.getSource('countries')) map.removeSource('countries');
      } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map]);

  /* ── countries: push data when geojson loads/changes ── */
  useEffect(() => {
    if (!isLoaded || !map || !countries) return;
    const src = map.getSource('countries');
    if (src) {
      try { src.setData(countries); } catch { /* ignore */ }
    }
  }, [isLoaded, map, countries]);

  /* ── update country paint/filter when deps change ── */
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer('country-fill')) return;
    for (const [key, value] of Object.entries(countryFillPaint)) {
      try { map.setPaintProperty('country-fill', key, value); } catch { /* ignore */ }
    }
  }, [isLoaded, map, countryFillPaint]);

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer('country-border')) return;
    for (const [key, value] of Object.entries(countryLinePaint)) {
      try { map.setPaintProperty('country-border', key, value); } catch { /* ignore */ }
    }
  }, [isLoaded, map, countryLinePaint]);

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer('country-selected-glow')) return;
    try { map.setFilter('country-selected-glow', selectedGlowFilter); } catch { /* ignore */ }
    for (const [key, value] of Object.entries(selectedGlowPaint)) {
      try { map.setPaintProperty('country-selected-glow', key, value); } catch { /* ignore */ }
    }
  }, [isLoaded, map, selectedGlowFilter, selectedGlowPaint]);

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer('country-spike-border')) return;
    try { map.setFilter('country-spike-border', spikeBorderFilter); } catch { /* ignore */ }
    for (const [key, value] of Object.entries(spikeBorderPaint)) {
      try { map.setPaintProperty('country-spike-border', key, value); } catch { /* ignore */ }
    }
  }, [isLoaded, map, spikeBorderFilter, spikeBorderPaint]);

  /* ── feature-state selected ── */
  useEffect(() => {
    if (!isLoaded || !map || !map.getSource('countries')) return;
    if (prevSelectedRef.current) {
      map.setFeatureState(
        { source: 'countries', id: prevSelectedRef.current },
        { selected: false },
      );
    }
    if (selectedRegion) {
      map.setFeatureState(
        { source: 'countries', id: selectedRegion },
        { selected: true },
      );
    }
    prevSelectedRef.current = selectedRegion;
  }, [isLoaded, map, selectedRegion, countries]);

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
          'line-color': '#00d4ff',
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
  }, [isLoaded, map]);

  /* ── update arc data ── */
  useEffect(() => {
    if (!isLoaded || !map) return;
    const src = map.getSource('arcs');
    if (src) src.setData(activeArcsGeoJson);
  }, [isLoaded, map, activeArcsGeoJson]);

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
  }, [isLoaded, map, mapOverlay]);

  /* ── hover arc filter ── */
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer('arc-hover')) return;
    if (hoveredArcId) {
      const [a, b] = hoveredArcId.split('-');
      try {
        map.setFilter('arc-hover', ['all',
          ['==', ['get', 'startIso'], a],
          ['==', ['get', 'endIso'], b],
        ]);
      } catch { /* ignore */ }
    } else {
      try { map.setFilter('arc-hover', ['==', 1, 0]); } catch { /* ignore */ }
    }
  }, [isLoaded, map, hoveredArcId]);

  /* ── arc pulses ── */
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
  }, [isLoaded, map]);

  useEffect(() => {
    if (!isLoaded || !map) return;
    const src = map.getSource('arc-pulses');
    if (src) src.setData(arcPulses);
  }, [isLoaded, map, arcPulses]);

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
  }, [isLoaded, map, arcsGeoJson, hoveredArcId]);

  /* ── articles clustered source + layers ── */
  useEffect(() => {
    if (!isLoaded || !map) return undefined;

    if (!map.getSource('articles')) {
      map.addSource('articles', {
        type: 'geojson',
        data: articlesGeoJson,
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 60,
      });
    }
    if (!map.getLayer('cluster-circles')) {
      map.addLayer({
        id: 'cluster-circles', type: 'circle', source: 'articles',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': 'rgba(0, 200, 255, 0.12)',
          'circle-radius': [
            'step', ['get', 'point_count'],
            8, 10, 10, 50, 12,
          ],
          'circle-stroke-width': 0.5,
          'circle-stroke-color': 'rgba(0, 200, 255, 0.25)',
        },
      });
    }
    if (!map.getLayer('cluster-count')) {
      map.addLayer({
        id: 'cluster-count', type: 'symbol', source: 'articles',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Open Sans Semibold'],
          'text-size': 9,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': 'rgba(0, 220, 255, 0.7)',
        },
      });
    }
    if (!map.getLayer('article-markers')) {
      map.addLayer({
        id: 'article-markers', type: 'circle', source: 'articles',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': [
            'interpolate', ['linear'],
            ['get', 'articleCount'],
            1, 4,
            5, 7,
            10, 10,
            20, 14,
          ],
          'circle-opacity': 0.85,
          'circle-stroke-width': 0.8,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-opacity': 0.6,
        },
      });
    }

    return () => {
      try {
        if (map.getLayer('article-markers')) map.removeLayer('article-markers');
        if (map.getLayer('cluster-count')) map.removeLayer('cluster-count');
        if (map.getLayer('cluster-circles')) map.removeLayer('cluster-circles');
        if (map.getSource('articles')) map.removeSource('articles');
      } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map]);

  useEffect(() => {
    if (!isLoaded || !map) return;
    const src = map.getSource('articles');
    if (src) src.setData(articlesGeoJson);
  }, [isLoaded, map, articlesGeoJson]);

  /* ── tracking icons ── */
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
  }, [isLoaded, map]);

  useEffect(() => {
    if (!isLoaded || !map) return;
    const src = map.getSource('tracking-markers');
    if (src) src.setData(trackingGeoJson);
  }, [isLoaded, map, trackingGeoJson]);

  /* ── locality labels (flat only) ── */
  useEffect(() => {
    if (!isLoaded || !map) return undefined;
    if (surface !== 'flat') return undefined;

    if (!map.getSource('locality-labels')) {
      map.addSource('locality-labels', { type: 'geojson', data: localityLabelsGeoJson });
    }
    if (!map.getLayer('locality-label-text')) {
      map.addLayer({
        id: 'locality-label-text', type: 'symbol', source: 'locality-labels',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Semibold'],
          'text-size': 12,
          'text-offset': [0, 1.4],
          'text-anchor': 'top',
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'text-max-width': 10,
        },
        paint: {
          'text-color': 'rgba(255, 255, 255, 0.85)',
          'text-halo-color': 'rgba(0, 0, 0, 0.7)',
          'text-halo-width': 1.5,
        },
      });
    }
    return () => {
      try {
        if (map.getLayer('locality-label-text')) map.removeLayer('locality-label-text');
        if (map.getSource('locality-labels')) map.removeSource('locality-labels');
      } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map, surface]);

  useEffect(() => {
    if (!isLoaded || !map || surface !== 'flat') return;
    const src = map.getSource('locality-labels');
    if (src) src.setData(localityLabelsGeoJson);
  }, [isLoaded, map, localityLabelsGeoJson, surface]);

  /* ── selected story source + layers ── */
  useEffect(() => {
    if (!isLoaded || !map) return undefined;

    if (!map.getSource('selected-story')) {
      map.addSource('selected-story', { type: 'geojson', data: selectedStoryGeoJson });
    }
    if (!map.getLayer('selected-story-glow')) {
      map.addLayer({
        id: 'selected-story-glow', type: 'circle', source: 'selected-story',
        paint: {
          'circle-color': 'rgba(255, 255, 255, 0.15)',
          'circle-radius': 18,
          'circle-blur': 1,
        },
      });
    }
    if (!map.getLayer('selected-story-marker')) {
      map.addLayer({
        id: 'selected-story-marker', type: 'circle', source: 'selected-story',
        paint: {
          'circle-color': '#ffffff',
          'circle-radius': 7,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    }
    return () => {
      try {
        if (map.getLayer('selected-story-marker')) map.removeLayer('selected-story-marker');
        if (map.getLayer('selected-story-glow')) map.removeLayer('selected-story-glow');
        if (map.getSource('selected-story')) map.removeSource('selected-story');
      } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map]);

  useEffect(() => {
    if (!isLoaded || !map) return;
    const src = map.getSource('selected-story');
    if (src) src.setData(selectedStoryGeoJson);
  }, [isLoaded, map, selectedStoryGeoJson]);

  /* ── velocity spike source + layers ── */
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

  /* ──────────────────────────── event handlers ──────────────────────────── */

  const latestHandlers = useRef({ onStorySelect, onRegionSelect, onArcSelect });
  latestHandlers.current = { onStorySelect, onRegionSelect, onArcSelect };

  const latestData = useRef({ newsList, trackingPoints, regionSeverities, coverageStatusByIso });
  latestData.current = { newsList, trackingPoints, regionSeverities, coverageStatusByIso };

  useEffect(() => {
    if (!isLoaded || !map) return undefined;

    const handleMouseMove = (e) => {
      // Arc hover first
      let arcFeats = [];
      try {
        arcFeats = map.queryRenderedFeatures(e.point, { layers: ['arc-lines', 'arc-glow'] });
      } catch { arcFeats = []; }
      const arcId = arcFeats.length > 0
        ? `${arcFeats[0].properties.startIso}-${arcFeats[0].properties.endIso}`
        : null;
      setHoveredArcId((prev) => prev !== arcId ? arcId : prev);

      if (arcId) {
        map.getCanvas().style.cursor = 'pointer';
        setHoverInfo(null);
        if (hoveredIsoRef.current) {
          try {
            map.setFeatureState({ source: 'countries', id: hoveredIsoRef.current }, { hover: false });
          } catch { /* ignore */ }
          hoveredIsoRef.current = null;
        }
        return;
      }

      let features = [];
      try {
        features = map.queryRenderedFeatures(e.point, { layers: ['country-fill'] });
      } catch { features = []; }
      const iso = features?.[0]?.properties?._iso || null;
      const name = features?.[0]?.properties?.NAME || features?.[0]?.properties?.ADMIN || iso;

      if (hoveredIsoRef.current && hoveredIsoRef.current !== iso) {
        try {
          map.setFeatureState(
            { source: 'countries', id: hoveredIsoRef.current },
            { hover: false },
          );
        } catch { /* ignore */ }
      }
      if (iso && iso !== hoveredIsoRef.current) {
        try {
          map.setFeatureState(
            { source: 'countries', id: iso },
            { hover: true },
          );
        } catch { /* ignore */ }
      }
      hoveredIsoRef.current = iso;
      map.getCanvas().style.cursor = iso ? 'pointer' : '';

      if (iso) {
        const rd = latestData.current.regionSeverities[iso];
        const ce = latestData.current.coverageStatusByIso[iso];
        setHoverInfo({ lng: e.lngLat.lng, lat: e.lngLat.lat, name, iso, regionData: rd || null, coverageEntry: ce || null });
      } else {
        setHoverInfo(null);
      }
    };

    const handleMouseLeave = () => {
      if (hoveredIsoRef.current) {
        try {
          map.setFeatureState(
            { source: 'countries', id: hoveredIsoRef.current },
            { hover: false },
          );
        } catch { /* ignore */ }
        hoveredIsoRef.current = null;
      }
      setHoveredArcId(null);
      setHoverInfo(null);
      map.getCanvas().style.cursor = '';
    };

    const handleClick = (e) => {
      // tracking
      let trackFeatures = [];
      try { trackFeatures = map.queryRenderedFeatures(e.point, { layers: ['tracking-icons'] }); } catch { /* ignore */ }
      if (trackFeatures.length > 0) {
        const props = trackFeatures[0].properties;
        const coords = trackFeatures[0].geometry.coordinates.slice();
        const isAir = props.kind === 'air';
        const point = latestData.current.trackingPoints.find((p) => p.id === props.id);
        const details = [];
        if (isAir && point) {
          if (point.altitude != null) details.push(`${Math.round(point.altitude)}m alt`);
          if (point.velocity != null) details.push(`${Math.round(point.velocity)}m/s`);
          if (point.originCountry) details.push(point.originCountry);
        } else if (point) {
          if (point.speed != null) details.push(`${point.speed.toFixed(1)}kn`);
        }
        setPopupInfo({
          lng: coords[0],
          lat: coords[1],
          title: props.label || props.id,
          severity: isAir ? 'Aircraft' : 'Vessel',
          severityAccent: isAir ? '#7ecbff' : '#44ddb0',
          severityMuted: isAir ? 'rgba(126,203,255,0.15)' : 'rgba(68,221,176,0.15)',
          locality: details.join(' · '),
          category: props.emergency || '',
        });
        return;
      }

      let markerFeatures = [];
      try { markerFeatures = map.queryRenderedFeatures(e.point, { layers: ['article-markers'] }); } catch { /* ignore */ }
      if (markerFeatures.length > 0) {
        const props = markerFeatures[0].properties;
        const story = latestData.current.newsList.find((s) => s.id === props.id);
        if (story) {
          latestHandlers.current.onStorySelect?.(story);
          const coords = markerFeatures[0].geometry.coordinates.slice();
          const meta = getSeverityMeta(story.severity);
          setPopupInfo({
            lng: coords[0],
            lat: coords[1],
            title: story.title,
            severity: meta.label,
            severityAccent: meta.accent,
            severityMuted: meta.muted,
            locality: story.locality,
            category: story.category,
          });
          return;
        }
      }

      let clusterFeatures = [];
      try { clusterFeatures = map.queryRenderedFeatures(e.point, { layers: ['cluster-circles'] }); } catch { /* ignore */ }
      if (clusterFeatures.length > 0) {
        const clusterId = clusterFeatures[0].properties.cluster_id;
        const source = map.getSource('articles');
        if (source && source.getClusterExpansionZoom) {
          try {
            const p = source.getClusterExpansionZoom(clusterId);
            if (p && typeof p.then === 'function') {
              p.then((zoom) => {
                map.flyTo({
                  center: clusterFeatures[0].geometry.coordinates,
                  zoom,
                  duration: 600,
                });
              }).catch(() => { /* ignore */ });
            } else {
              source.getClusterExpansionZoom(clusterId, (err, zoom) => {
                if (err) return;
                map.flyTo({
                  center: clusterFeatures[0].geometry.coordinates,
                  zoom,
                  duration: 600,
                });
              });
            }
          } catch { /* ignore */ }
        }
        return;
      }

      let arcFeatures = [];
      try { arcFeatures = map.queryRenderedFeatures(e.point, { layers: ['arc-lines', 'arc-glow'] }); } catch { /* ignore */ }
      if (arcFeatures.length > 0 && latestHandlers.current.onArcSelect) {
        const props = arcFeatures[0].properties;
        latestHandlers.current.onArcSelect({
          startIso: props.startIso,
          endIso: props.endIso,
          startRegion: props.startRegion,
          endRegion: props.endRegion,
          category: props.category,
          severity: props.severity,
          type: props.arcType || 'same-event',
          label: props.arcLabel || null,
        });
        setPopupInfo(null);
        return;
      }

      let countryFeatures = [];
      try { countryFeatures = map.queryRenderedFeatures(e.point, { layers: ['country-fill'] }); } catch { /* ignore */ }
      if (countryFeatures.length > 0) {
        const iso = countryFeatures[0].properties._iso;
        if (iso) {
          latestHandlers.current.onRegionSelect?.(iso);
          setPopupInfo(null);
        }
      }
    };

    map.on('mousemove', handleMouseMove);
    map.on('mouseout', handleMouseLeave);
    map.on('click', handleClick);

    return () => {
      map.off('mousemove', handleMouseMove);
      map.off('mouseout', handleMouseLeave);
      map.off('click', handleClick);
    };
  }, [isLoaded, map]);

  /* ──────────────────────────── popups (React components) ──────────────────────────── */

  const handleClosePopup = useCallback(() => setPopupInfo(null), []);

  return (
    <>
      {hoverInfo && !popupInfo && (
        <MapPopup
          longitude={hoverInfo.lng}
          latitude={hoverInfo.lat}
          anchor="bottom"
          closeOnClick={false}
          closeButton={false}
          className="flatmap-gl-hover"
          maxWidth="200px"
          offset={12}
        >
          <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '10px', lineHeight: '1.5', color: isLight ? '#1a1a1a' : '#e0e0e0' }}>
            <div style={{ fontWeight: 600, fontSize: '11px', marginBottom: '2px' }}>{hoverInfo.name}</div>
            {hoverInfo.regionData ? (() => {
              const hMeta = getSeverityMeta(hoverInfo.regionData.peakSeverity);
              return (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ opacity: 0.5 }}>Severity</span>
                    <span style={{ color: hMeta.accent, fontWeight: 500 }}>{hMeta.label}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ opacity: 0.5 }}>Reports</span>
                    <span>{hoverInfo.regionData.count}</span>
                  </div>
                </>
              );
            })() : hoverInfo.coverageEntry ? (() => {
              const cMeta = getCoverageMeta(hoverInfo.coverageEntry.status);
              return (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <span style={{ opacity: 0.5 }}>Status</span>
                  <span style={{ color: cMeta.accent }}>{hoverInfo.coverageEntry.status}</span>
                </div>
              );
            })() : (
              <div style={{ opacity: 0.4 }}>No data</div>
            )}
          </div>
        </MapPopup>
      )}

      {popupInfo && (
        <MapPopup
          longitude={popupInfo.lng}
          latitude={popupInfo.lat}
          anchor="bottom"
          closeOnClick
          closeButton
          onClose={handleClosePopup}
          className="flatmap-gl-popup"
          maxWidth="260px"
        >
          <div style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '11px',
            lineHeight: '1.4',
            color: isLight ? '#1a1a1a' : '#e0e0e0',
          }}>
            <div style={{
              display: 'inline-block',
              padding: '1px 6px',
              borderRadius: '2px',
              fontSize: '9px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              background: popupInfo.severityMuted,
              color: popupInfo.severityAccent,
              marginBottom: '4px',
            }}>
              {popupInfo.severity}
            </div>
            <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '3px' }}>
              {popupInfo.title}
            </div>
            <div style={{ opacity: 0.6, fontSize: '10px' }}>
              {[popupInfo.locality, popupInfo.category].filter(Boolean).join(' · ')}
            </div>
          </div>
        </MapPopup>
      )}
    </>
  );
};

export default MapGLOverlay;
export { severityToColor };
