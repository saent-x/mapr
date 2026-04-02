import React, { useEffect, useMemo, useRef, useState } from 'react';
import GlobeGL from 'react-globe.gl';
import { useTranslation } from 'react-i18next';
import countriesUrl from '../assets/ne_110m_admin_0_countries.geojson?url';
import earthTexture from '../assets/earth-night.jpg';
import skyTexture from '../assets/night-sky.png';
import { getSeverityMeta } from '../utils/mockData';
import { getCoverageMeta } from '../utils/coverageMeta';
import { isoToCountry, areCountriesAdjacent } from '../utils/geocoder';
import {
  buildCountryCoOccurrences,
  buildGeopoliticalArcData,
  coOccurrenceToStroke,
  coOccurrenceToColor,
  buildCountryStoryMap,
} from '../utils/geopoliticalArcs';

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

// Normalize codebase category names → canonical causal pair categories
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

const DEFAULT_VIEW = { lat: 20, lng: 10, altitude: 2.2 };

// Coverage ring styles — distinct from severity rings
const COVERAGE_RING_STYLES = {
  verified:        { color: '#00e5a0', maxRadius: 3,   speed: 0.8, repeat: 2500 },
  developing:      { color: '#00d4ff', maxRadius: 3.5, speed: 1.0, repeat: 2000 },
  'ingestion-risk':{ color: '#ffaa00', maxRadius: 4,   speed: 1.5, repeat: 1500 },
  'source-sparse': { color: '#ff8800', maxRadius: 4.5, speed: 2.0, repeat: 1200 },
  uncovered:       { color: '#ff4444', maxRadius: 5.5, speed: 2.5, repeat: 800  },
};

// On small screens, don't zoom in as far — the globe fills the viewport quickly
const isMobile = typeof screen !== 'undefined' && screen.width < 768;
const STORY_ALTITUDE = isMobile ? 1.4 : 0.7;
const REGION_ALTITUDE = isMobile ? 1.6 : 0.9;

const getIso = (f) => {
  const iso = f?.properties?.ISO_A2;
  if (iso && iso !== '-99') return iso;
  return f?.properties?.WB_A2 || f?.properties?.ADM0_A3_US || null;
};

const Globe = ({
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
  onArcSelect
}) => {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const globeRef = useRef(null);
  const initRef = useRef(false);
  const dragRef = useRef({ down: false, moved: false, x: 0, y: 0 });

  const [countries, setCountries] = useState({ features: [] });
  const [hoveredCountry, setHoveredCountry] = useState(null);
  const [hoveredArc, setHoveredArc] = useState(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [userDragged, setUserDragged] = useState(false);

  // Disable hover on touch devices
  const isTouchDevice = useMemo(() => (
    typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
      && typeof screen !== 'undefined' && screen.width < 768
  ), []);
  const handlePolygonHover = isTouchDevice ? undefined : setHoveredCountry;

  // Fetch country GeoJSON
  useEffect(() => {
    let mounted = true;
    fetch(countriesUrl)
      .then((r) => r.json())
      .then((data) => mounted && setCountries(data))
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  // Resize observer
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;

    const update = () => {
      setSize({ width: node.clientWidth, height: node.clientHeight });
    };
    update();

    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  // Drag detection for pausing auto-rotate
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;

    const onDown = (e) => {
      dragRef.current = { down: true, moved: false, x: e.clientX, y: e.clientY };
    };
    const onMove = (e) => {
      if (!dragRef.current.down) return;
      if (Math.abs(e.clientX - dragRef.current.x) > 5 || Math.abs(e.clientY - dragRef.current.y) > 5) {
        dragRef.current.moved = true;
      }
    };
    const onUp = () => {
      if (dragRef.current.moved) setUserDragged(true);
      dragRef.current = { down: false, moved: false, x: 0, y: 0 };
    };
    const onWheel = () => setUserDragged(true);

    node.addEventListener('pointerdown', onDown);
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointerleave', onUp);
    node.addEventListener('wheel', onWheel, { passive: true });

    return () => {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointerleave', onUp);
      node.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Globe controls init
  useEffect(() => {
    if (!globeRef.current) return;
    const ctrl = globeRef.current.controls();
    ctrl.enableDamping = true;
    ctrl.dampingFactor = 0.08;
    ctrl.autoRotateSpeed = 0.08;
    ctrl.target.set(0, 0, 0);
    ctrl.update();

    if (!initRef.current) {
      globeRef.current.pointOfView(DEFAULT_VIEW, 0);
      initRef.current = true;
    }
  }, [size.width, size.height]);

  // Auto-rotate logic
  useEffect(() => {
    if (!globeRef.current) return;
    globeRef.current.controls().autoRotate = !selectedStory && !selectedRegion && !userDragged;
  }, [selectedRegion, selectedStory, userDragged]);

  // Camera movement
  useEffect(() => {
    if (!globeRef.current) return;

    if (selectedStory) {
      globeRef.current.pointOfView(
        { lat: selectedStory.coordinates[0], lng: selectedStory.coordinates[1], altitude: STORY_ALTITUDE },
        1200
      );
      return;
    }

    if (selectedRegion) {
      const focal = regionSeverities[selectedRegion]?.peakStory
        || newsList.find((s) => s.isoA2 === selectedRegion);
      if (focal) {
        globeRef.current.pointOfView(
          { lat: focal.coordinates[0], lng: focal.coordinates[1], altitude: REGION_ALTITUDE },
          1200
        );
        return;
      }
    }

    globeRef.current.pointOfView(DEFAULT_VIEW, 1200);
  }, [newsList, regionSeverities, selectedRegion, selectedStory]);

  // Points: show all articles globally, highlight active region
  // Filter out any articles with invalid coordinates (null, missing, or [0,0])
  const safeNewsList = useMemo(() => newsList.filter((s) =>
    s.coordinates && Array.isArray(s.coordinates) && s.coordinates.length >= 2
    && !(s.coordinates[0] === 0 && s.coordinates[1] === 0)
  ), [newsList]);

  const mergedPointData = useMemo(() => {
    const list = [...safeNewsList];
    for (const p of trackingPoints) {
      if (p.lat == null || p.lng == null) continue;
      list.push({
        id: p.id,
        __trackKind: p.kind,
        coordinates: [p.lat, p.lng],
        isoA2: null,
        severity: 12,
        title: p.label,
        articleCount: 1,
        locality: p.kind === 'air' ? 'ADS-B' : 'AIS',
        category: 'tracking',
      });
    }
    return list;
  }, [safeNewsList, trackingPoints]);

  const activeRegion = selectedRegion || (hoveredCountry ? getIso(hoveredCountry) : null);

  const isActivePoint = (s) => s.__trackKind ? false : s.isoA2 === activeRegion;

  // Build a lookup: ISO → best representative story with coordinates
  const isoToStoryRef = useMemo(() => {
    const map = {};
    for (const story of newsList) {
      if (!story.isoA2 || !story.coordinates) continue;
      if (!map[story.isoA2] || story.severity > map[story.isoA2].severity) {
        map[story.isoA2] = story;
      }
    }
    return map;
  }, [newsList]);

  // Rings: severity mode = activity pulses, coverage mode = coverage status per country
  const ringData = useMemo(() => {
    if (mapOverlay === 'coverage') {
      // Coverage rings: one per country with known coordinates, colored by coverage status
      const coverageRings = [];
      for (const [iso, entry] of Object.entries(coverageStatusByIso)) {
        const story = isoToStoryRef[iso];
        if (!story?.coordinates) continue;
        const status = entry.status || 'uncovered';
        const style = COVERAGE_RING_STYLES[status] || COVERAGE_RING_STYLES.uncovered;
        coverageRings.push({
          ...story,
          _isCoverageRing: true,
          _coverageStatus: status,
          _coverageStyle: style,
          _coverageIso: iso,
        });
      }
      // Add velocity spike rings on top
      for (const spike of velocitySpikes.slice(0, 10)) {
        const story = isoToStoryRef[spike.iso];
        if (story && !coverageRings.some(r => r._coverageIso === spike.iso)) {
          coverageRings.push({ ...story, _velocitySpike: true, _spikeLevel: spike.level, _zScore: spike.zScore });
        }
      }
      return coverageRings;
    }

    // Severity mode: ambient activity rings + velocity spike rings
    if (selectedStory) return [selectedStory];
    const ambient = newsList
      .filter((s) => s.severity >= 60)
      .slice(0, 12);

    // Add velocity spike rings in severity mode too
    const spikeRings = [];
    for (const spike of velocitySpikes.slice(0, 10)) {
      const story = isoToStoryRef[spike.iso];
      if (story && !ambient.some(a => a.id === story.id)) {
        spikeRings.push({ ...story, _velocitySpike: true, _spikeLevel: spike.level, _zScore: spike.zScore });
      }
    }

    if (selectedRegion) {
      const regionRings = newsList
        .filter((s) => s.isoA2 === selectedRegion && s.severity >= 40)
        .slice(0, 6);
      const ids = new Set(regionRings.map((s) => s.id));
      return [...regionRings, ...ambient.filter((s) => !ids.has(s.id)), ...spikeRings].slice(0, 20);
    }
    return [...ambient, ...spikeRings];
  }, [coverageStatusByIso, isoToStoryRef, mapOverlay, newsList, selectedRegion, selectedStory, velocitySpikes]);

  // Arcs: connect countries from events' multi-country countries arrays
  const arcData = useMemo(() => {
    const arcs = [];
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
      arcs.push({
        id: pairKey,
        startLat: a.coordinates[0],
        startLng: a.coordinates[1],
        endLat: b.coordinates[0],
        endLng: b.coordinates[1],
        startIso: isoA,
        endIso: isoB,
        startRegion: a.region || a.locality,
        endRegion: b.region || b.locality,
        severity: severity ?? Math.round((a.severity + b.severity) / 2),
        category: category || a.category || b.category || 'related',
        title: title || a.title,
        type,
        label,
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

    return arcs
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 30);
  }, [newsList]);

  // Geopolitical co-occurrence arcs
  const geoArcData = useMemo(() => {
    if (mapOverlay !== 'geopolitical') return [];
    const coOccurrences = buildCountryCoOccurrences(newsList);
    const storyMap = buildCountryStoryMap(newsList);
    return buildGeopoliticalArcData(coOccurrences, storyMap);
  }, [newsList, mapOverlay]);

  const activeArcData = mapOverlay === 'geopolitical' ? geoArcData : arcData;
  const geoMaxCount = geoArcData.length > 0 ? geoArcData[0].count : 1;

  // Helpers
  const getRegionSev = (f) => {
    const iso = getIso(f);
    return iso ? regionSeverities[iso]?.averageSeverity || 0 : 0;
  };

  const getCoverageEntry = (featureOrIso) => {
    const iso = typeof featureOrIso === 'string' ? featureOrIso : getIso(featureOrIso);
    return iso ? coverageStatusByIso[iso] || null : null;
  };

  const getCoverageStatus = (featureOrIso) => getCoverageEntry(featureOrIso)?.status || 'uncovered';

  return (
    <div ref={containerRef} className="globe-wrapper">
      {size.width > 0 && size.height > 0 && (
        <GlobeGL
          ref={globeRef}
          width={size.width}
          height={size.height}
          animateIn
          waitForGlobeReady
          globeImageUrl={earthTexture}
          backgroundImageUrl={skyTexture}
          showAtmosphere
          atmosphereColor="#00a8cc"
          atmosphereAltitude={0.22}

          /* === POLYGONS === */
          polygonsData={countries.features}

          polygonAltitude={(f) => {
            const iso = getIso(f);
            const sev = getRegionSev(f);
            const isHov = hoveredCountry && getIso(hoveredCountry) === iso;
            const isSel = iso === selectedRegion;
            if (isSel) return sev ? Math.max(0.03, 0.01 + sev / 1200) : 0.02;
            if (isHov) return sev ? Math.max(0.02, 0.0075 + sev / 1600) : 0.0125;
            if (sev) return 0.002 + sev / 8000;
            return 0;
          }}

          polygonCapColor={(f) => {
            const iso = getIso(f);
            const sev = getRegionSev(f);
            const isHov = hoveredCountry && getIso(hoveredCountry) === iso;
            const isSel = iso === selectedRegion;
            if (sev) {
              const meta = getSeverityMeta(sev);
              if (isSel || isHov) return meta.mapFill;
              const alpha = 0.08 + (sev / 100) * 0.14;
              const hex = meta.accent;
              const r = parseInt(hex.slice(1, 3), 16);
              const g = parseInt(hex.slice(3, 5), 16);
              const b = parseInt(hex.slice(5, 7), 16);
              return `rgba(${r},${g},${b},${alpha})`;
            }
            if (isSel) return 'rgba(0, 200, 255, 0.15)';
            if (isHov) return 'rgba(0, 200, 255, 0.08)';
            return 'rgba(0, 180, 255, 0.02)';
          }}

          polygonSideColor={(f) => {
            const iso = getIso(f);
            const sev = getRegionSev(f);
            const isHov = hoveredCountry && getIso(hoveredCountry) === iso;
            const isSel = iso === selectedRegion;
            if ((isSel || isHov) && sev) return getSeverityMeta(sev).mapSide;
            if (isSel || isHov) return 'rgba(0, 180, 255, 0.06)';
            return 'rgba(0, 0, 0, 0)';
          }}

          polygonStrokeColor={(f) => {
            const iso = getIso(f);
            if (iso === selectedRegion) return 'rgba(0, 240, 255, 0.6)';
            if (hoveredCountry && getIso(hoveredCountry) === iso) return 'rgba(0, 220, 255, 0.35)';
            return 'rgba(0, 200, 255, 0.07)';
          }}

          polygonLabel={(f) => {
            const sev = Math.round(getRegionSev(f));
            const iso = getIso(f);
            const meta = getSeverityMeta(sev);
            const count = regionSeverities[iso]?.count || 0;

            return `
              <div class="globe-tooltip">
                <div class="globe-tooltip-name">${f.properties.ADMIN}</div>
                <div class="globe-tooltip-row">
                  <span>${t('map.severity')}</span>
                  <strong style="color:${sev ? meta.accent : 'inherit'}">${sev || 'Quiet'}</strong>
                </div>
                <div class="globe-tooltip-row">
                  <span>${t('map.reports')}</span>
                  <strong>${count}</strong>
                </div>
              </div>
            `;
          }}

          onPolygonHover={handlePolygonHover}
          onPolygonClick={(p) => {
            const iso = getIso(p);
            if (iso) onRegionSelect(iso);
          }}

          /* === POINTS (articles + optional flight/vessel overlay) === */
          pointsData={mergedPointData}
          pointLat={(s) => s.coordinates[0]}
          pointLng={(s) => s.coordinates[1]}
          pointAltitude={(s) => {
            if (s.__trackKind) return 0.0035;
            if (selectedStory?.id === s.id) return 0.015;
            if (isActivePoint(s)) return 0.0075 + s.severity / 2800;
            return 0.0025;
          }}
          pointRadius={(s) => {
            if (s.__trackKind) return 0.22;
            if (selectedStory?.id === s.id) return 0.35;
            const markerSize = Math.min(0.6, 0.15 + (s.articleCount || 1) * 0.05);
            if (isActivePoint(s)) return markerSize;
            return markerSize * 0.55;
          }}
          pointColor={(s) => {
            if (s.__trackKind === 'air') return '#7ecbff';
            if (s.__trackKind === 'sea') return '#44ddb0';
            if (selectedStory?.id === s.id) return '#ffffff';
            const meta = getSeverityMeta(s.severity);
            if (isActivePoint(s)) return meta.accent;
            return meta.muted.replace(/[\d.]+\)$/, (m) => `${Math.min(parseFloat(m) * 1.6, 0.35)})`);
          }}
          pointLabel={(s) => {
            if (s.__trackKind) {
              return `
              <div class="globe-tooltip">
                <div class="globe-tooltip-name">${s.title}</div>
                <div class="globe-tooltip-row">
                  <span>${s.locality}</span>
                  <strong>${s.__trackKind === 'air' ? 'Aircraft' : 'Vessel'}</strong>
                </div>
              </div>`;
            }
            if (!isActivePoint(s)) return '';
            const meta = getSeverityMeta(s.severity);
            const articleCount = s.articleCount || 1;
            const lifecycleRow = s.lifecycle
              ? `<div class="globe-tooltip-row">
                  <span>${t('map.lifecycle') || 'Lifecycle'}</span>
                  <strong>${s.lifecycle}</strong>
                </div>`
              : '';
            return `
              <div class="globe-tooltip">
                <div class="globe-tooltip-name">${s.title}</div>
                <div class="globe-tooltip-row">
                  <span>${s.locality}</span>
                  <strong style="color:${meta.accent}">${meta.label}</strong>
                </div>
                <div class="globe-tooltip-row">
                  <span>${t('map.sources') || 'Sources'}</span>
                  <strong>${articleCount}</strong>
                </div>
                ${lifecycleRow}
              </div>
            `;
          }}
          onPointClick={(s) => {
            if (s.__trackKind) return;
            onStorySelect(s);
          }}

          /* === ARCS (connect countries with related crises / geopolitical) === */
          arcsData={activeArcData}
          arcStartLat={(d) => d.startLat}
          arcStartLng={(d) => d.startLng}
          arcEndLat={(d) => d.endLat}
          arcEndLng={(d) => d.endLng}
          arcColor={(d) => {
            if (d.type === 'geopolitical') {
              const color = coOccurrenceToColor(d.count, geoMaxCount);
              const isHov = hoveredArc && hoveredArc.id === d.id;
              return isHov ? [color, color] : [color, color.replace(/[\d.]+\)$/, '0.3)')];
            }
            const baseColor = ARC_COLORS[d.type] || ARC_COLORS['same-event'];
            const isHov = hoveredArc && hoveredArc.id === d.id;
            if (isHov) return [baseColor, baseColor];
            return [`${baseColor}90`, `${baseColor}40`];
          }}
          arcStroke={(d) => {
            if (d.type === 'geopolitical') {
              const isHov = hoveredArc && hoveredArc.id === d.id;
              const baseStroke = coOccurrenceToStroke(d.count, geoMaxCount);
              return isHov ? baseStroke * 1.5 : baseStroke * 0.5;
            }
            const isHov = hoveredArc && hoveredArc.id === d.id;
            if (isHov) return 1.2;
            if (d.severity >= 85) return 0.4;
            if (d.severity >= 60) return 0.3;
            if (d.severity >= 35) return 0.2;
            return 0.15;
          }}
          arcDashLength={(d) => {
            if (d.type === 'geopolitical') return 1; // Solid lines for geopolitical
            const isHov = hoveredArc && hoveredArc.id === d.id;
            return isHov ? 1 : 0.8;
          }}
          arcDashGap={(d) => {
            if (d.type === 'geopolitical') return 0;
            const isHov = hoveredArc && hoveredArc.id === d.id;
            return isHov ? 0 : 0.3;
          }}
          arcDashAnimateTime={(d) => {
            if (d.type === 'geopolitical') return 0;
            const isHov = hoveredArc && hoveredArc.id === d.id;
            if (isHov) return 0; // stop animation on hover
            if (d.severity >= 85) return 4000;
            if (d.severity >= 60) return 6000;
            return 8000;
          }}
          arcAltitudeAutoScale={0.35}
          onArcHover={setHoveredArc}
          arcLabel={(d) => {
            if (d.type === 'geopolitical') {
              const startName = isoToCountry(d.startIso) || d.startRegion || d.startIso;
              const endName = isoToCountry(d.endIso) || d.endRegion || d.endIso;
              const color = coOccurrenceToColor(d.count, geoMaxCount);
              return `
                <div class="globe-tooltip">
                  <div class="globe-tooltip-name" style="color:${color}">Geopolitical</div>
                  <div class="globe-tooltip-row">
                    <span>${startName}</span>
                    <strong>↔</strong>
                    <span>${endName}</span>
                  </div>
                  <div class="globe-tooltip-row">
                    <span>Shared stories</span>
                    <strong style="color:${color}">${d.count}</strong>
                  </div>
                </div>
              `;
            }
            const meta = getSeverityMeta(d.severity);
            const typeColor = ARC_COLORS[d.type] || ARC_COLORS['same-event'];
            const typeLabel = d.type === 'shared-actor' ? `Actor: ${d.label || d.category}`
              : d.type === 'causal-flow' ? `Flow: ${d.label || d.category}`
              : d.category;
            return `
              <div class="globe-tooltip">
                <div class="globe-tooltip-name" style="color:${typeColor}">${typeLabel}</div>
                <div class="globe-tooltip-row">
                  <span>${d.startRegion}</span>
                  <strong>↔</strong>
                  <span>${d.endRegion}</span>
                </div>
                <div class="globe-tooltip-row">
                  <span>${t('map.severity')}</span>
                  <strong style="color:${meta.accent}">${meta.label} · ${d.severity}</strong>
                </div>
              </div>
            `;
          }}
          onArcClick={(d) => {
            if (onArcSelect) onArcSelect(d);
          }}
          arcsTransitionDuration={600}

          /* === RINGS (ambient activity pulses) === */
          ringsData={ringData}
          ringLat={(s) => s.coordinates[0]}
          ringLng={(s) => s.coordinates[1]}
          ringColor={(s) => {
            if (s._isCoverageRing) {
              const c = s._coverageStyle.color;
              return [c, `${c}88`, `${c}33`, 'rgba(255,255,255,0)'];
            }
            if (s._velocitySpike) {
              const color = s._spikeLevel === 'spike' ? '#ff5577' : '#ffaa33';
              return [color, `${color}88`, `${color}33`, 'rgba(255,255,255,0)'];
            }
            const meta = getSeverityMeta(s.severity);
            return [meta.accent, meta.ring, meta.muted, 'rgba(255,255,255,0)'];
          }}
          ringMaxRadius={(s) => {
            if (s._isCoverageRing) return s._coverageStyle.maxRadius;
            if (s._velocitySpike) return s._spikeLevel === 'spike' ? 5 : 3.5;
            if (selectedStory?.id === s.id) return 4 + s.severity / 16;
            if (s.isoA2 === selectedRegion) return 3 + s.severity / 20;
            return 2 + s.severity / 30;
          }}
          ringPropagationSpeed={(s) => {
            if (s._isCoverageRing) return s._coverageStyle.speed;
            if (s._velocitySpike) return s._spikeLevel === 'spike' ? 2.5 : 1.8;
            if (selectedStory?.id === s.id || s.isoA2 === selectedRegion) return 2;
            return 1.2;
          }}
          ringRepeatPeriod={(s) => {
            if (s._isCoverageRing) return s._coverageStyle.repeat;
            if (s._velocitySpike) return s._spikeLevel === 'spike' ? 900 : 1400;
            if (selectedStory?.id === s.id) return 800;
            if (s.severity >= 85) return 1200;
            if (s.severity >= 60) return 1800;
            return 2400;
          }}

          /* === TRANSITIONS === */
          polygonsTransitionDuration={0}
          pointsTransitionDuration={300}
        />
      )}
    </div>
  );
};

export default Globe;
