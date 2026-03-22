import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { Source, Layer, Popup, useMap } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Globe2, Crosshair } from 'lucide-react';
import countriesUrl from '../assets/ne_110m_admin_0_countries.geojson?url';
import { getSeverityMeta } from '../utils/mockData';
import { getCoverageMeta } from '../utils/coverageMeta';
import { isoToCountry, areCountriesAdjacent } from '../utils/geocoder';

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

/* ──────────────────────────── constants ──────────────────────────── */

const STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json';
const STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json';

const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
const STORY_ZOOM = isMobile ? 5 : 8;
const REGION_ZOOM = isMobile ? 3.5 : 5;
const DEFAULT_ZOOM = isMobile ? 1.5 : 2;
const DEFAULT_CENTER = { lng: 10, lat: 20 };

const getIso = (f) => {
  const iso = f?.properties?.ISO_A2;
  if (iso && iso !== '-99') return iso;
  return f?.properties?.WB_A2 || f?.properties?.ADM0_A3_US || null;
};

/* severity thresholds → accent color for MapLibre match expressions */
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

/* ──────────────────────────── macro regions ──────────────────────────── */

const MACRO_REGIONS = {
  africa: { label: 'Africa', bounds: [[-20, -35], [55, 38]], isos: new Set(['DZ','AO','BJ','BW','BF','BI','CM','CV','CF','TD','KM','CG','CD','CI','DJ','EG','GQ','ER','SZ','ET','GA','GM','GH','GN','GW','KE','LS','LR','LY','MG','MW','ML','MR','MU','MA','MZ','NA','NE','NG','RW','ST','SN','SC','SL','SO','ZA','SS','SD','TZ','TG','TN','UG','ZM','ZW']) },
  europe: { label: 'Europe', bounds: [[-25, 35], [45, 72]], isos: new Set(['AL','AD','AT','BY','BE','BA','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE','IT','XK','LV','LI','LT','LU','MT','MD','MC','ME','NL','MK','NO','PL','PT','RO','RU','SM','RS','SK','SI','ES','SE','CH','UA','GB']) },
  asia: { label: 'Asia', bounds: [[60, -10], [150, 55]], isos: new Set(['AF','BD','BT','BN','KH','CN','IN','ID','JP','KZ','KG','LA','MY','MV','MN','MM','NP','KP','KR','PK','PH','SG','LK','TW','TJ','TH','TL','TM','UZ','VN']) },
  middleEast: { label: 'Middle East', bounds: [[25, 10], [65, 45]], isos: new Set(['BH','IR','IQ','IL','JO','KW','LB','OM','PS','QA','SA','SY','TR','AE','YE']) },
  northAmerica: { label: 'N. America', bounds: [[-170, 5], [-50, 85]], isos: new Set(['AG','BS','BB','BZ','CA','CR','CU','DM','DO','SV','GD','GT','HT','HN','JM','MX','NI','PA','KN','LC','VC','TT','US']) },
  southAmerica: { label: 'S. America', bounds: [[-85, -60], [-30, 15]], isos: new Set(['AR','BO','BR','CL','CO','EC','GY','PY','PE','SR','UY','VE']) },
  oceania: { label: 'Oceania', bounds: [[100, -50], [180, 5]], isos: new Set(['AU','FJ','KI','MH','FM','NR','NZ','PW','PG','WS','SB','TO','TV','VU']) },
};

/* ──────────────────────────── component ──────────────────────────── */

const FlatMap = ({
  newsList,
  regionSeverities,
  mapOverlay,
  coverageStatusByIso = {},
  selectedRegion,
  selectedStory,
  onRegionSelect,
  onStorySelect,
  onArcSelect,
}) => {
  const { t } = useTranslation();
  const mapRef = useRef(null);
  const hoveredIsoRef = useRef(null);
  const [hoveredArcId, setHoveredArcId] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);

  const [countries, setCountries] = useState(null);
  const [theme, setTheme] = useState(() =>
    document.documentElement.getAttribute('data-theme') || 'dark',
  );
  const [popupInfo, setPopupInfo] = useState(null);
  const [drillRegion, setDrillRegion] = useState(null);

  const isLight = theme === 'light';
  const mapStyle = isLight ? STYLE_LIGHT : STYLE_DARK;

  /* ── fly-to tracking refs ── */
  const prevStoryRef = useRef(null);
  const prevRegionRef = useRef(null);
  const hadSelectionRef = useRef(false);

  /* ── theme observer ── */
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute('data-theme') || 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  /* ── fetch countries GeoJSON ── */
  useEffect(() => {
    fetch(countriesUrl)
      .then((r) => r.json())
      .then((geojson) => {
        // Preprocess: add _iso promoted id
        const processed = {
          ...geojson,
          features: geojson.features.map((f) => ({
            ...f,
            properties: { ...f.properties, _iso: getIso(f) || '' },
          })),
        };
        setCountries(processed);
      })
      .catch(() => {});
  }, []);

  /* ── resize handling ── */
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    const container = mapRef.current?.getContainer();
    if (container) observer.observe(container);
    return () => observer.disconnect();
  }, []);

  /* ── fly-to logic ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (selectedStory && selectedStory.id !== prevStoryRef.current) {
      map.flyTo({
        center: [selectedStory.coordinates[1], selectedStory.coordinates[0]],
        zoom: STORY_ZOOM,
        duration: 1200,
      });
      prevStoryRef.current = selectedStory.id;
      hadSelectionRef.current = true;
      return;
    }

    if (selectedRegion && selectedRegion !== prevRegionRef.current) {
      const focal =
        regionSeverities[selectedRegion]?.peakStory ||
        newsList.find((s) => s.isoA2 === selectedRegion);
      if (focal) {
        map.flyTo({
          center: [focal.coordinates[1], focal.coordinates[0]],
          zoom: REGION_ZOOM,
          duration: 1200,
        });
      }
      prevRegionRef.current = selectedRegion;
      hadSelectionRef.current = true;
      return;
    }

    if (!selectedStory && !selectedRegion && hadSelectionRef.current) {
      prevStoryRef.current = null;
      prevRegionRef.current = null;
      hadSelectionRef.current = false;
      map.flyTo({
        center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
        zoom: DEFAULT_ZOOM,
        duration: 1200,
      });
    }
  }, [selectedStory, selectedRegion, regionSeverities, newsList]);

  /* ── drill region fly ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drillRegion && MACRO_REGIONS[drillRegion]) {
      const region = MACRO_REGIONS[drillRegion];
      map.fitBounds(region.bounds, { padding: 40, duration: 1200 });
    } else if (drillRegion === null) {
      // handled by fly-to logic above or default view
    }
  }, [drillRegion]);

  /* ── story counts per macro region ── */
  const regionStoryCounts = useMemo(() => {
    const counts = {};
    for (const key of Object.keys(MACRO_REGIONS)) counts[key] = 0;
    for (const story of newsList) {
      const iso = story.isoA2;
      if (!iso) continue;
      for (const [key, region] of Object.entries(MACRO_REGIONS)) {
        if (region.isos.has(iso)) {
          counts[key]++;
          break;
        }
      }
    }
    return counts;
  }, [newsList]);

  /* ── country fill paint expression ── */
  const countryFillPaint = useMemo(() => {
    const drillIsos = drillRegion ? MACRO_REGIONS[drillRegion]?.isos : null;

    if (mapOverlay === 'coverage') {
      // Coverage overlay: color by coverage status
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
          // Dim outside drill region
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

    // Severity overlay
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
        // Has severity data → normal, otherwise faint
        ...(Object.keys(regionSeverities).length > 0 ? [
          ['in', ['get', '_iso'], ['literal', Object.keys(regionSeverities)]],
          0.2,
        ] : []),
        0.03,
      ],
    };
  }, [regionSeverities, mapOverlay, coverageStatusByIso, drillRegion]);

  /* ── country border paint ── */
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

  /* ── selected glow border (separate layer for wider glow) ── */
  const selectedGlowPaint = useMemo(() => {
    if (!selectedRegion) return null;
    return {
      'line-color': 'rgba(0, 212, 255, 0.25)',
      'line-width': 5,
      'line-blur': 4,
    };
  }, [selectedRegion]);

  const selectedGlowFilter = useMemo(() => {
    return selectedRegion ? ['==', ['get', '_iso'], selectedRegion] : ['==', 1, 0];
  }, [selectedRegion]);

  /* ── article markers GeoJSON ── */
  const articlesGeoJson = useMemo(() => ({
    type: 'FeatureCollection',
    features: newsList
      .filter((s) => s.coordinates && s.coordinates.length >= 2)
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
          coordinates: [story.coordinates[1], story.coordinates[0]], // swap lat/lng → lng/lat
        },
      })),
  }), [newsList]);

  /* ── selected story marker ── */
  const selectedStoryGeoJson = useMemo(() => {
    if (!selectedStory || !selectedStory.coordinates) return null;
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

  /* ── arcs: lines between countries from events' multi-country countries arrays ── */
  const arcsGeoJson = useMemo(() => {
    const features = [];
    const seen = new Set();

    // Build a lookup: ISO → best representative story (highest severity with coordinates)
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

    // 1. Same-event arcs: multi-country events
    for (const story of newsList) {
      const eventCountries = story.countries;
      if (!Array.isArray(eventCountries) || eventCountries.length < 2) continue;
      for (let i = 0; i < eventCountries.length; i++) {
        for (let j = i + 1; j < eventCountries.length; j++) {
          addArc(eventCountries[i], eventCountries[j], story.severity, story.category, story.title, 'same-event');
        }
      }
    }

    // 2. Shared-actor arcs: entity name appears in events in 2+ different countries
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

    // 3. Causal-flow arcs: category pairs between adjacent countries
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

  /* ── hover handling ── */
  const onMouseMove = useCallback((e) => {
    const map = mapRef.current;
    if (!map) return;

    // Check arc hover first
    const arcFeats = map.queryRenderedFeatures(e.point, { layers: ['arc-lines', 'arc-glow'] });
    const arcId = arcFeats.length > 0
      ? `${arcFeats[0].properties.startIso}-${arcFeats[0].properties.endIso}`
      : null;
    setHoveredArcId((prev) => prev !== arcId ? arcId : prev);

    if (arcId) {
      map.getCanvas().style.cursor = 'pointer';
      setHoverInfo(null);
      if (hoveredIsoRef.current) {
        map.setFeatureState({ source: 'countries', id: hoveredIsoRef.current }, { hover: false });
        hoveredIsoRef.current = null;
      }
      return;
    }

    // Country hover
    const features = map.queryRenderedFeatures(e.point, { layers: ['country-fill'] });
    const iso = features?.[0]?.properties?._iso || null;
    const name = features?.[0]?.properties?.NAME || features?.[0]?.properties?.ADMIN || iso;

    if (hoveredIsoRef.current && hoveredIsoRef.current !== iso) {
      map.setFeatureState(
        { source: 'countries', id: hoveredIsoRef.current },
        { hover: false },
      );
    }
    if (iso && iso !== hoveredIsoRef.current) {
      map.setFeatureState(
        { source: 'countries', id: iso },
        { hover: true },
      );
    }
    hoveredIsoRef.current = iso;
    map.getCanvas().style.cursor = iso ? 'pointer' : '';

    // Build hover popup info
    if (iso) {
      const rd = regionSeverities[iso];
      const ce = coverageStatusByIso[iso];
      setHoverInfo({ lng: e.lngLat.lng, lat: e.lngLat.lat, name, iso, regionData: rd || null, coverageEntry: ce || null });
    } else {
      setHoverInfo(null);
    }
  }, []);

  const onMouseLeave = useCallback(() => {
    const map = mapRef.current;
    if (map && hoveredIsoRef.current) {
      map.setFeatureState(
        { source: 'countries', id: hoveredIsoRef.current },
        { hover: false },
      );
      hoveredIsoRef.current = null;
    }
    setHoveredArcId(null);
    setHoverInfo(null);
    if (map) map.getCanvas().style.cursor = '';
  }, []);

  /* ── selected country feature state ── */
  const prevSelectedRef = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource('countries')) return;
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
  }, [selectedRegion]);

  /* ── click handlers ── */
  const onMapClick = useCallback((e) => {
    const map = mapRef.current;
    if (!map) return;

    // Check article markers first
    const markerFeatures = map.queryRenderedFeatures(e.point, { layers: ['article-markers'] });
    if (markerFeatures.length > 0) {
      const props = markerFeatures[0].properties;
      const story = newsList.find((s) => s.id === props.id);
      if (story) {
        onStorySelect(story);
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

    // Check cluster clicks
    const clusterFeatures = map.queryRenderedFeatures(e.point, { layers: ['cluster-circles'] });
    if (clusterFeatures.length > 0) {
      const clusterId = clusterFeatures[0].properties.cluster_id;
      const source = map.getSource('articles');
      source.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        map.flyTo({
          center: clusterFeatures[0].geometry.coordinates,
          zoom: zoom,
          duration: 600,
        });
      });
      return;
    }

    // Check arc lines
    const arcFeatures = map.queryRenderedFeatures(e.point, { layers: ['arc-lines', 'arc-glow'] });
    if (arcFeatures.length > 0 && onArcSelect) {
      const props = arcFeatures[0].properties;
      onArcSelect({
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

    // Check country polygons
    const countryFeatures = map.queryRenderedFeatures(e.point, { layers: ['country-fill'] });
    if (countryFeatures.length > 0) {
      const iso = countryFeatures[0].properties._iso;
      if (iso) {
        onRegionSelect(iso);
        setPopupInfo(null);
      }
    }
  }, [newsList, onStorySelect, onRegionSelect, onArcSelect]);

  /* ── drill navigation ── */
  const handleDrillSelect = useCallback((regionKey) => {
    setDrillRegion(regionKey);
  }, []);

  const handleDrillBack = useCallback(() => {
    setDrillRegion(null);
    const map = mapRef.current;
    if (map) {
      map.flyTo({
        center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
        zoom: DEFAULT_ZOOM,
        duration: 1200,
      });
    }
  }, []);

  /* ── breadcrumb ── */
  const breadcrumb = useMemo(() => {
    const parts = [{ label: 'WORLD', onClick: handleDrillBack }];
    if (drillRegion && MACRO_REGIONS[drillRegion]) {
      parts.push({
        label: MACRO_REGIONS[drillRegion].label.toUpperCase(),
        onClick: () => setDrillRegion(drillRegion),
      });
    }
    if (selectedRegion) {
      const name = isoToCountry(selectedRegion) || selectedRegion;
      parts.push({ label: name.toUpperCase(), onClick: null });
    }
    return parts;
  }, [drillRegion, selectedRegion, handleDrillBack]);

  /* ── on map load: set up resize observer properly ── */
  const onMapLoad = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);
  }, []);

  /* ── animated pulses traveling along arc lines ── */
  const [arcPulses, setArcPulses] = useState({ type: 'FeatureCollection', features: [] });

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (hoveredArcId) return;
    const lines = arcsGeoJson.features;
    if (lines.length === 0) return;

    let frame;
    let t = 0;

    const animate = () => {
      t = (t + 0.003) % 1;
      const points = [];
      for (let i = 0; i < lines.length; i++) {
        const coords = lines[i].geometry.coordinates;
        const props = lines[i].properties;
        // Each arc gets a pulse at a staggered offset
        const offset = (t + i * 0.13) % 1;
        const lng = coords[0][0] + (coords[1][0] - coords[0][0]) * offset;
        const lat = coords[0][1] + (coords[1][1] - coords[0][1]) * offset;
        points.push({
          type: 'Feature',
          properties: { color: props.color, severity: props.severity },
          geometry: { type: 'Point', coordinates: [lng, lat] },
        });
      }
      setArcPulses({ type: 'FeatureCollection', features: points });
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [arcsGeoJson, hoveredArcId]);

  return (
    <div className="flatmap-wrapper">
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: DEFAULT_CENTER.lng,
          latitude: DEFAULT_CENTER.lat,
          zoom: DEFAULT_ZOOM,
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyle}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={onMapClick}
        onLoad={onMapLoad}
        attributionControl={false}
        reuseMaps
      >
        {/* ── Country polygons ── */}
        {countries && (
          <Source
            id="countries"
            type="geojson"
            data={countries}
            promoteId="_iso"
          >
            <Layer
              id="country-fill"
              type="fill"
              paint={countryFillPaint}
            />
            <Layer
              id="country-border"
              type="line"
              paint={countryLinePaint}
            />
            {/* Glow on selected country */}
            <Layer
              id="country-selected-glow"
              type="line"
              filter={selectedGlowFilter}
              paint={selectedGlowPaint || { 'line-color': 'transparent', 'line-width': 0 }}
            />
          </Source>
        )}

        {/* ── Crisis connection arcs ── */}
        <Source id="arcs" type="geojson" data={arcsGeoJson}>
          {/* Soft glow underneath */}
          <Layer
            id="arc-glow"
            type="line"
            paint={{
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
            }}
          />
          {/* Solid line */}
          <Layer
            id="arc-lines"
            type="line"
            layout={{ 'line-cap': 'round' }}
            paint={{
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
            }}
          />
          {/* Hover highlight — solid bright line, no dash */}
          {hoveredArcId && (
            <Layer
              id="arc-hover"
              type="line"
              filter={['all',
                ['==', ['get', 'startIso'], hoveredArcId.split('-')[0]],
                ['==', ['get', 'endIso'], hoveredArcId.split('-')[1]],
              ]}
              paint={{
                'line-color': '#00d4ff',
                'line-width': 2,
                'line-opacity': 0.7,
              }}
            />
          )}
        </Source>

        {/* ── Traveling pulse dots along arcs ── */}
        <Source id="arc-pulses" type="geojson" data={arcPulses}>
          <Layer
            id="arc-pulse-glow"
            type="circle"
            paint={{
              'circle-color': ['get', 'color'],
              'circle-radius': 5,
              'circle-opacity': 0.15,
              'circle-blur': 1,
            }}
          />
          <Layer
            id="arc-pulse-dot"
            type="circle"
            paint={{
              'circle-color': ['get', 'color'],
              'circle-radius': 2,
              'circle-opacity': 0.6,
            }}
          />
        </Source>

        {/* ── Article markers with clustering ── */}
        <Source
          id="articles"
          type="geojson"
          data={articlesGeoJson}
          cluster={true}
          clusterMaxZoom={12}
          clusterRadius={60}
        >
          {/* Cluster dots — small, non-intrusive */}
          <Layer
            id="cluster-circles"
            type="circle"
            filter={['has', 'point_count']}
            paint={{
              'circle-color': 'rgba(0, 200, 255, 0.12)',
              'circle-radius': [
                'step', ['get', 'point_count'],
                8, 10, 10, 50, 12,
              ],
              'circle-stroke-width': 0.5,
              'circle-stroke-color': 'rgba(0, 200, 255, 0.25)',
            }}
          />
          {/* Cluster count — small label */}
          <Layer
            id="cluster-count"
            type="symbol"
            filter={['has', 'point_count']}
            layout={{
              'text-field': '{point_count_abbreviated}',
              'text-font': ['Open Sans Semibold'],
              'text-size': 9,
              'text-allow-overlap': true,
            }}
            paint={{
              'text-color': 'rgba(0, 220, 255, 0.7)',
            }}
          />
          {/* Individual article markers */}
          <Layer
            id="article-markers"
            type="circle"
            filter={['!', ['has', 'point_count']]}
            paint={{
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
            }}
          />
        </Source>

        {/* ── Selected story marker (on top) ── */}
        {selectedStoryGeoJson && (
          <Source id="selected-story" type="geojson" data={selectedStoryGeoJson}>
            {/* Glow */}
            <Layer
              id="selected-story-glow"
              type="circle"
              paint={{
                'circle-color': 'rgba(255, 255, 255, 0.15)',
                'circle-radius': 18,
                'circle-blur': 1,
              }}
            />
            {/* Marker */}
            <Layer
              id="selected-story-marker"
              type="circle"
              paint={{
                'circle-color': '#ffffff',
                'circle-radius': 7,
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff',
              }}
            />
          </Source>
        )}

        {/* ── Region hover tooltip ── */}
        {hoverInfo && !popupInfo && (
          <Popup
            longitude={hoverInfo.lng}
            latitude={hoverInfo.lat}
            anchor="bottom"
            closeButton={false}
            closeOnClick={false}
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
          </Popup>
        )}

        {/* ── Story click popup ── */}
        {popupInfo && (
          <Popup
            longitude={popupInfo.lng}
            latitude={popupInfo.lat}
            anchor="bottom"
            closeOnClick={true}
            onClose={() => setPopupInfo(null)}
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
                {[popupInfo.locality, popupInfo.category].filter(Boolean).join(' \u00b7 ')}
              </div>
            </div>
          </Popup>
        )}
      </Map>

      {/* ── Breadcrumb ── */}
      {(drillRegion || selectedRegion) && (
        <div style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: isMobile ? '9px' : '10px',
          letterSpacing: '0.08em',
          color: isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)',
          background: isLight ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(8px)',
          padding: '4px 8px',
          borderRadius: '3px',
          border: `1px solid ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(0,200,255,0.1)'}`,
          pointerEvents: 'auto',
        }}>
          {breadcrumb.map((part, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <ChevronRight
                  size={10}
                  style={{ opacity: 0.4, flexShrink: 0 }}
                />
              )}
              {part.onClick ? (
                <span
                  onClick={part.onClick}
                  style={{
                    cursor: 'pointer',
                    color: isLight ? 'rgba(0,0,0,0.7)' : 'rgba(0,200,255,0.7)',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) => e.target.style.color = isLight ? '#000' : '#00d4ff'}
                  onMouseLeave={(e) => e.target.style.color = isLight ? 'rgba(0,0,0,0.7)' : 'rgba(0,200,255,0.7)'}
                >
                  {part.label}
                </span>
              ) : (
                <span style={{
                  color: isLight ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.8)',
                  whiteSpace: 'nowrap',
                }}>
                  {part.label}
                </span>
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* ── Region selector (desktop only) ── */}
      {!isMobile && (
        <div style={{
          position: 'absolute',
          bottom: 40,
          left: 10,
          zIndex: 10,
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '10px',
          letterSpacing: '0.06em',
          background: isLight ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(8px)',
          borderRadius: '4px',
          border: `1px solid ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(0,200,255,0.08)'}`,
          overflow: 'hidden',
          pointerEvents: 'auto',
        }}>
          {/* World / overview button */}
          <div
            onClick={handleDrillBack}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 10px',
              cursor: 'pointer',
              borderBottom: `1px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(0,200,255,0.06)'}`,
              color: !drillRegion
                ? (isLight ? '#000' : '#00d4ff')
                : (isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.4)'),
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = isLight ? '#000' : '#00d4ff';
              e.currentTarget.style.background = isLight ? 'rgba(0,0,0,0.03)' : 'rgba(0,200,255,0.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = !drillRegion
                ? (isLight ? '#000' : '#00d4ff')
                : (isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.4)');
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Globe2 size={11} />
            <span>{t('map.world', 'WORLD')}</span>
            <span style={{ marginLeft: 'auto', opacity: 0.4 }}>{newsList.length}</span>
          </div>

          {/* Region entries */}
          {Object.entries(MACRO_REGIONS).map(([key, region]) => {
            const isActive = drillRegion === key;
            const count = regionStoryCounts[key] || 0;
            return (
              <div
                key={key}
                onClick={() => handleDrillSelect(key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '4px 10px',
                  cursor: 'pointer',
                  color: isActive
                    ? (isLight ? '#000' : '#00d4ff')
                    : (isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.35)'),
                  borderBottom: `1px solid ${isLight ? 'rgba(0,0,0,0.04)' : 'rgba(0,200,255,0.04)'}`,
                  transition: 'color 0.15s, background 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = isLight ? '#000' : '#00d4ff';
                  e.currentTarget.style.background = isLight ? 'rgba(0,0,0,0.03)' : 'rgba(0,200,255,0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = isActive
                    ? (isLight ? '#000' : '#00d4ff')
                    : (isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.35)');
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <Crosshair size={9} style={{ opacity: 0.5 }} />
                <span>{region.label.toUpperCase()}</span>
                <span style={{ marginLeft: 'auto', opacity: 0.35, fontSize: '9px' }}>
                  {count > 0 ? count : '\u2014'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FlatMap;
