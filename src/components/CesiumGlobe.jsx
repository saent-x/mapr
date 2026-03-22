import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import countriesUrl from '../assets/ne_110m_admin_0_countries.geojson?url';
import { getSeverityMeta } from '../utils/mockData';
import { getCoverageMeta } from '../utils/coverageMeta';
import { isoToCountry, areCountriesAdjacent } from '../utils/geocoder';

Cesium.Ion.defaultAccessToken = undefined;

/* ── Constants ── */

const ARC_TYPE_COLORS = {
  'same-event': Cesium.Color.WHITE.withAlpha(0.5),
  'shared-actor': Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.5),
  'causal-flow': Cesium.Color.fromCssColorString('#ffaa00').withAlpha(0.5),
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

const INITIAL_CAMERA = { lng: 10, lat: 20, height: 18000000 };
const STORY_FLY_HEIGHT = 3000000;
const REGION_FLY_HEIGHT = 5000000;
const FLY_DURATION = 1.2;
const AUTO_ROTATE_SPEED = 0.08; // degrees per second

/* ── Helpers ── */

function cssToColor(css, alpha) {
  try {
    const c = Cesium.Color.fromCssColorString(css);
    return alpha != null ? c.withAlpha(alpha) : c;
  } catch {
    return Cesium.Color.CYAN.withAlpha(0.05);
  }
}

function getIso(entity) {
  const p = entity?.properties;
  if (!p) return null;
  const get = (k) => {
    const v = p[k];
    return v?.getValue ? v.getValue(Cesium.JulianDate.now()) : v;
  };
  const iso = get('ISO_A2');
  if (iso && iso !== '-99') return iso;
  return get('WB_A2') || get('ADM0_A3_US') || null;
}

function getEntityName(entity) {
  const p = entity?.properties;
  if (!p) return '';
  const v = p.ADMIN || p.NAME;
  return v?.getValue ? v.getValue(Cesium.JulianDate.now()) : (v || '');
}

/* ── Component ── */

const CesiumGlobe = ({
  newsList,
  regionSeverities,
  mapOverlay,
  coverageStatusByIso = {},
  velocitySpikes = [],
  selectedRegion,
  selectedStory,
  onRegionSelect,
  onStorySelect,
  onArcSelect
}) => {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const countryDsRef = useRef(null);
  const markerDsRef = useRef(null);
  const arcDsRef = useRef(null);
  const ringDsRef = useRef(null);
  const handlerRef = useRef(null);
  const tooltipRef = useRef(null);
  const rotateListenerRef = useRef(null);
  const userInteractedRef = useRef(false);
  const [hoveredIso, setHoveredIso] = useState(null);
  const [hoveredEntity, setHoveredEntity] = useState(null);
  const [countriesLoaded, setCountriesLoaded] = useState(false);

  // Keep latest callbacks in a ref so event handlers always see current values
  const cbRef = useRef({ onRegionSelect, onStorySelect, onArcSelect, newsList });
  cbRef.current = { onRegionSelect, onStorySelect, onArcSelect, newsList };

  /* ── Derived data: arcs ── */
  const arcData = useMemo(() => {
    const arcs = [];
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
      const key = [isoA, isoB].sort().join('-');
      if (seen.has(key)) return;
      const a = countryStoryMap[isoA];
      const b = countryStoryMap[isoB];
      if (!a || !b) return;
      seen.add(key);
      arcs.push({
        id: key, startLat: a.coordinates[0], startLng: a.coordinates[1],
        endLat: b.coordinates[0], endLng: b.coordinates[1],
        startIso: isoA, endIso: isoB,
        startRegion: a.region || a.locality, endRegion: b.region || b.locality,
        severity: severity ?? Math.round((a.severity + b.severity) / 2),
        category: category || a.category || b.category || 'related',
        title: title || a.title, type, label,
      });
    };

    // 1. Same-event arcs
    for (const story of newsList) {
      const cc = story.countries;
      if (!Array.isArray(cc) || cc.length < 2) continue;
      for (let i = 0; i < cc.length; i++) {
        for (let j = i + 1; j < cc.length; j++) {
          addArc(cc[i], cc[j], story.severity, story.category, story.title, 'same-event');
        }
      }
    }

    // 2. Shared-actor arcs
    const entityMap = {};
    for (const story of newsList) {
      if (!story.isoA2) continue;
      for (const org of (story.entities?.organizations || [])) {
        if (!org.name) continue;
        if (!entityMap[org.name]) entityMap[org.name] = [];
        entityMap[org.name].push({ iso: story.isoA2, severity: story.severity, title: story.title });
      }
    }
    for (const [entityName, occurrences] of Object.entries(entityMap)) {
      const unique = [...new Set(occurrences.map(o => o.iso))];
      if (unique.length >= 2) {
        const maxSev = Math.max(...occurrences.map(o => o.severity || 0));
        addArc(unique[0], unique[1], maxSev, 'shared-actor', entityName, 'shared-actor', entityName);
      }
    }

    // 3. Causal-flow arcs
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

    return arcs.sort((a, b) => b.severity - a.severity).slice(0, 30);
  }, [newsList]);

  /* ── Derived data: ring targets ── */
  const isoToStoryMap = useMemo(() => {
    const map = {};
    for (const story of newsList) {
      if (!story.isoA2 || !story.coordinates) continue;
      if (!map[story.isoA2] || story.severity > map[story.isoA2].severity) {
        map[story.isoA2] = story;
      }
    }
    return map;
  }, [newsList]);

  const ringData = useMemo(() => {
    if (mapOverlay === 'coverage') {
      const spikeRings = [];
      for (const spike of velocitySpikes.slice(0, 10)) {
        const story = isoToStoryMap[spike.iso];
        if (story) spikeRings.push({ ...story, _velocitySpike: true, _spikeLevel: spike.level });
      }
      if (selectedStory) return [selectedStory, ...spikeRings.filter(s => s.id !== selectedStory.id)];
      return spikeRings;
    }
    if (selectedStory) return [selectedStory];
    const ambient = newsList.filter(s => s.severity >= 60).slice(0, 12);
    if (selectedRegion) {
      const regionRings = newsList.filter(s => s.isoA2 === selectedRegion && s.severity >= 40).slice(0, 6);
      const ids = new Set(regionRings.map(s => s.id));
      return [...regionRings, ...ambient.filter(s => !ids.has(s.id))].slice(0, 14);
    }
    return ambient;
  }, [isoToStoryMap, mapOverlay, newsList, selectedRegion, selectedStory, velocitySpikes]);

  /* ── Initialize Cesium Viewer ── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Destroy previous viewer if it exists (React StrictMode double-mount)
    if (viewerRef.current && !viewerRef.current.isDestroyed()) {
      viewerRef.current.destroy();
      viewerRef.current = null;
    }
    // Clean up any leftover Cesium DOM from previous viewer
    const staleNodes = el.querySelectorAll('.cesium-viewer');
    staleNodes.forEach(n => n.remove());

    // Force explicit pixel dimensions — Cesium needs this
    const rect = el.getBoundingClientRect();
    console.log('[CesiumGlobe] Container size:', rect.width, 'x', rect.height);
    if (rect.width === 0 || rect.height === 0) {
      console.warn('[CesiumGlobe] Container has zero size, delaying init');
      const timer = setTimeout(() => {
        // Force re-run by clearing ref
        viewerRef.current = null;
      }, 100);
      return () => clearTimeout(timer);
    }

    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.className = 'globe-tooltip';
    tooltip.style.cssText = 'position:absolute;pointer-events:none;z-index:1000;display:none;transform:translate(-50%,-100%);margin-top:-12px;';
    containerRef.current.appendChild(tooltip);
    tooltipRef.current = tooltip;

    const viewer = new Cesium.Viewer(containerRef.current, {
      timeline: false,
      animation: false,
      homeButton: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      geocoder: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      creditContainer: document.createElement('div'),
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      imageryProvider: false, // disable default Ion imagery — no API key needed
      skyBox: false,
      skyAtmosphere: false,
      requestRenderMode: false,
      contextOptions: { webgl: { alpha: false } },
    });

    // Dark theme — no imagery layers at all
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#111111');
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#335577'); // BRIGHT for debug — should be very visible
    viewer.scene.globe.showGroundAtmosphere = false;
    viewer.scene.globe.enableLighting = false;
    viewer.scene.globe.depthTestAgainstTerrain = false;
    if (viewer.scene.sun) viewer.scene.sun.show = false;
    if (viewer.scene.moon) viewer.scene.moon.show = false;
    if (viewer.scene.fog) viewer.scene.fog.enabled = false;
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;

    // Initial camera
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(INITIAL_CAMERA.lng, INITIAL_CAMERA.lat, INITIAL_CAMERA.height),
      duration: 0,
    });

    // Input handler for click and hover
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    handlerRef.current = handler;

    // Click
    handler.setInputAction((e) => {
      const picked = viewer.scene.pick(e.position);
      if (!Cesium.defined(picked) || !picked.id) return;

      // Country polygon
      const iso = getIso(picked.id);
      if (iso) {
        cbRef.current.onRegionSelect(iso);
        return;
      }

      // Story marker
      const storyId = picked.id._storyId;
      if (storyId) {
        const story = cbRef.current.newsList.find(s => s.id === storyId);
        if (story) cbRef.current.onStorySelect(story);
        return;
      }

      // Arc
      const arcObj = picked.id._arcData;
      if (arcObj && cbRef.current.onArcSelect) {
        cbRef.current.onArcSelect(arcObj);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Hover
    handler.setInputAction((e) => {
      const picked = viewer.scene.pick(e.endPosition);
      if (Cesium.defined(picked) && picked.id) {
        const iso = getIso(picked.id);
        if (iso) {
          setHoveredIso(iso);
          setHoveredEntity(picked.id);
          viewer.canvas.style.cursor = 'pointer';
          return;
        }
        if (picked.id._storyId || picked.id._arcData) {
          setHoveredIso(null);
          setHoveredEntity(picked.id);
          viewer.canvas.style.cursor = 'pointer';
          return;
        }
      }
      setHoveredIso(null);
      setHoveredEntity(null);
      viewer.canvas.style.cursor = 'default';
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // Track user interaction to stop auto-rotate
    const onInteraction = () => { userInteractedRef.current = true; };
    viewer.canvas.addEventListener('pointerdown', onInteraction);
    viewer.canvas.addEventListener('wheel', onInteraction, { passive: true });

    viewerRef.current = viewer;

    // Force resize and verify rendering
    requestAnimationFrame(() => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.resize();
        viewer.scene.requestRender();
        const canvas = viewer.canvas;
        console.log('[CesiumGlobe] Canvas:', canvas.width, 'x', canvas.height);
        console.log('[CesiumGlobe] Canvas parent:', canvas.parentElement?.className);
        console.log('[CesiumGlobe] Canvas style display:', getComputedStyle(canvas).display);
        console.log('[CesiumGlobe] Canvas style visibility:', getComputedStyle(canvas).visibility);
        console.log('[CesiumGlobe] Canvas style opacity:', getComputedStyle(canvas).opacity);
        console.log('[CesiumGlobe] Canvas getBoundingClientRect:', JSON.stringify(canvas.getBoundingClientRect()));
        // Check if WebGL is actually rendering pixels
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (gl) {
          const pixel = new Uint8Array(4);
          gl.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          console.log('[CesiumGlobe] Center pixel RGBA:', pixel[0], pixel[1], pixel[2], pixel[3]);
        } else {
          console.warn('[CesiumGlobe] Could not get WebGL context for pixel check');
        }
      }
    });
    console.log('[CesiumGlobe] Viewer created');
    console.log('[CesiumGlobe] Globe visible:', viewer.scene.globe.show);
    console.log('[CesiumGlobe] Scene mode:', viewer.scene.mode);

    // Test entity — bright red dot at 0,0 to verify rendering works
    viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(0, 0),
      point: { pixelSize: 20, color: Cesium.Color.RED },
      label: { text: 'TEST', font: '16px monospace', fillColor: Cesium.Color.RED, style: Cesium.LabelStyle.FILL }
    });

    return () => {
      viewer.canvas.removeEventListener('pointerdown', onInteraction);
      viewer.canvas.removeEventListener('wheel', onInteraction);
      handler.destroy();
      handlerRef.current = null;
      if (tooltipRef.current && tooltipRef.current.parentNode) {
        tooltipRef.current.parentNode.removeChild(tooltipRef.current);
      }
      tooltipRef.current = null;
      if (!viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  /* ── Load country GeoJSON ── */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    let cancelled = false;
    Cesium.GeoJsonDataSource.load(countriesUrl, {
      stroke: Cesium.Color.CYAN.withAlpha(0.5),
      strokeWidth: 2,
      fill: Cesium.Color.CYAN.withAlpha(0.15),
      clampToGround: false,
    }).then(ds => {
      if (cancelled || !viewerRef.current) return;
      countryDsRef.current = ds;
      viewer.dataSources.add(ds);
      setCountriesLoaded(true);
      console.log('[CesiumGlobe] GeoJSON loaded,', ds.entities.values.length, 'entities');
    });

    return () => { cancelled = true; };
  }, []);

  /* ── Color polygons when data/hover/selection/overlay changes ── */
  useEffect(() => {
    const ds = countryDsRef.current;
    if (!ds) return;

    const isCoverage = mapOverlay === 'coverage';
    const entities = ds.entities.values;

    for (const entity of entities) {
      const iso = getIso(entity);
      if (!iso || !entity.polygon) continue;

      const sev = regionSeverities[iso]?.averageSeverity || 0;
      const isSel = iso === selectedRegion;
      const isHov = iso === hoveredIso;

      let fill, outline;

      if (isCoverage) {
        const status = coverageStatusByIso[iso]?.status || 'uncovered';
        const cm = getCoverageMeta(status);
        fill = isSel ? cssToColor(cm.selectedFill) : isHov ? cssToColor(cm.hoverFill) : cssToColor(cm.fill);
        outline = isSel ? Cesium.Color.CYAN.withAlpha(0.8) : cssToColor(cm.stroke);
      } else {
        if (sev) {
          const meta = getSeverityMeta(sev);
          const alpha = 0.12 + (sev / 100) * 0.25;
          fill = (isSel || isHov) ? cssToColor(meta.mapFill) : cssToColor(meta.accent, alpha);
        } else {
          fill = isSel ? Cesium.Color.CYAN.withAlpha(0.2)
            : isHov ? Cesium.Color.CYAN.withAlpha(0.12)
            : Cesium.Color.CYAN.withAlpha(0.06);
        }
        outline = isSel ? Cesium.Color.CYAN.withAlpha(0.8)
          : isHov ? Cesium.Color.CYAN.withAlpha(0.5)
          : Cesium.Color.CYAN.withAlpha(0.2);
      }

      entity.polygon.material = fill;
      entity.polygon.outline = true;
      entity.polygon.outlineColor = outline;
      entity.polygon.height = 0;
      entity.polygon.classificationType = undefined; // don't classify against terrain
    }
    console.log('[CesiumGlobe] Colored', entities.length, 'polygons');
  }, [countriesLoaded, regionSeverities, coverageStatusByIso, mapOverlay, selectedRegion, hoveredIso]);

  /* ── Event markers ── */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (markerDsRef.current) {
      viewer.dataSources.remove(markerDsRef.current, true);
    }

    const ds = new Cesium.CustomDataSource('markers');
    markerDsRef.current = ds;

    for (const story of newsList) {
      if (!story.coordinates) continue;
      const meta = getSeverityMeta(story.severity);
      const size = Math.min(16, 6 + (story.articleCount || 1) * 1.5);
      const isSelected = selectedStory?.id === story.id;

      const entity = ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(story.coordinates[1], story.coordinates[0]),
        point: {
          pixelSize: isSelected ? 18 : size,
          color: isSelected ? Cesium.Color.WHITE : cssToColor(meta.accent, 1.0),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
          outlineWidth: 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      entity._storyId = story.id;
      entity._storyData = story;
    }

    viewer.dataSources.add(ds);
  }, [newsList, selectedStory]);

  /* ── Arc lines ── */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (arcDsRef.current) {
      viewer.dataSources.remove(arcDsRef.current, true);
    }

    const ds = new Cesium.CustomDataSource('arcs');
    arcDsRef.current = ds;

    for (const arc of arcData) {
      const color = ARC_TYPE_COLORS[arc.type] || ARC_TYPE_COLORS['same-event'];
      const width = Math.max(1, Math.min(3, arc.severity / 25));
      const midLat = (arc.startLat + arc.endLat) / 2;
      const midLng = (arc.startLng + arc.endLng) / 2;
      const midHeight = 200000 + arc.severity * 2500;

      const entity = ds.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArrayHeights([
            arc.startLng, arc.startLat, 20000,
            midLng, midLat, midHeight,
            arc.endLng, arc.endLat, 20000,
          ]),
          width,
          material: color,
          arcType: Cesium.ArcType.NONE,
        },
      });
      entity._arcData = arc;
    }

    viewer.dataSources.add(ds);
  }, [arcData]);

  /* ── Pulsing rings (static colored ellipses) ── */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (ringDsRef.current) {
      viewer.dataSources.remove(ringDsRef.current, true);
    }

    const ds = new Cesium.CustomDataSource('rings');
    ringDsRef.current = ds;

    for (const story of ringData) {
      if (!story.coordinates) continue;
      const meta = getSeverityMeta(story.severity);
      const isSelected = selectedStory?.id === story.id;
      const isSpiking = story._velocitySpike;

      let ringColor;
      let radius;
      if (isSpiking) {
        ringColor = story._spikeLevel === 'spike'
          ? Cesium.Color.fromCssColorString('#ffaa00').withAlpha(0.25)
          : Cesium.Color.fromCssColorString('#8aa7ff').withAlpha(0.2);
        radius = story._spikeLevel === 'spike' ? 180000 : 120000;
      } else if (isSelected) {
        ringColor = cssToColor(meta.accent, 0.35);
        radius = 150000 + story.severity * 1000;
      } else {
        ringColor = cssToColor(meta.accent, 0.18);
        radius = 80000 + story.severity * 600;
      }

      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(story.coordinates[1], story.coordinates[0]),
        ellipse: {
          semiMajorAxis: radius,
          semiMinorAxis: radius,
          material: ringColor,
          outline: true,
          outlineColor: cssToColor(meta.accent, 0.4),
          outlineWidth: 1,
          height: 0,
        },
      });
    }

    viewer.dataSources.add(ds);
  }, [ringData, selectedStory]);

  /* ── Camera fly-to on selection ── */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (selectedStory?.coordinates) {
      userInteractedRef.current = true; // stop auto-rotate on selection
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          selectedStory.coordinates[1], selectedStory.coordinates[0], STORY_FLY_HEIGHT
        ),
        duration: FLY_DURATION,
      });
    } else if (selectedRegion) {
      userInteractedRef.current = true;
      const focal = regionSeverities[selectedRegion]?.peakStory
        || newsList.find(s => s.isoA2 === selectedRegion);
      if (focal?.coordinates) {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            focal.coordinates[1], focal.coordinates[0], REGION_FLY_HEIGHT
          ),
          duration: FLY_DURATION,
        });
      }
    } else if (!selectedStory && !selectedRegion) {
      // Fly back to initial view on deselect, re-enable rotation
      userInteractedRef.current = false;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          INITIAL_CAMERA.lng, INITIAL_CAMERA.lat, INITIAL_CAMERA.height
        ),
        duration: FLY_DURATION,
      });
    }
  }, [selectedRegion, selectedStory, newsList, regionSeverities]);

  /* ── Auto-rotate ── */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const onPreRender = () => {
      if (userInteractedRef.current) return;
      if (selectedStory || selectedRegion) return;
      const camera = viewer.camera;
      camera.rotate(Cesium.Cartesian3.UNIT_Z, Cesium.Math.toRadians(AUTO_ROTATE_SPEED * 0.016));
    };

    viewer.scene.preRender.addEventListener(onPreRender);
    rotateListenerRef.current = onPreRender;

    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.scene.preRender.removeEventListener(onPreRender);
      }
    };
  }, [selectedStory, selectedRegion]);

  /* ── Tooltip positioning ── */
  useEffect(() => {
    const viewer = viewerRef.current;
    const tooltip = tooltipRef.current;
    if (!viewer || !tooltip) return;

    const updateTooltip = () => {
      if (!hoveredEntity) {
        tooltip.style.display = 'none';
        return;
      }

      // Determine what we're hovering and build HTML
      const iso = getIso(hoveredEntity);
      const storyData = hoveredEntity._storyData;
      const arcObj = hoveredEntity._arcData;

      let html = '';

      if (iso) {
        const name = getEntityName(hoveredEntity) || isoToCountry(iso) || iso;
        const isCoverage = mapOverlay === 'coverage';
        if (isCoverage) {
          const status = coverageStatusByIso[iso]?.status || 'uncovered';
          const cm = getCoverageMeta(status);
          html = `
            <div class="globe-tooltip-name">${name}</div>
            <div class="globe-tooltip-row">
              <span>Coverage</span>
              <strong style="color:${cm.accent}">${status}</strong>
            </div>`;
        } else {
          const sev = Math.round(regionSeverities[iso]?.averageSeverity || 0);
          const meta = getSeverityMeta(sev);
          const count = regionSeverities[iso]?.count || 0;
          html = `
            <div class="globe-tooltip-name">${name}</div>
            <div class="globe-tooltip-row">
              <span>Severity</span>
              <strong style="color:${sev ? meta.accent : 'inherit'}">${sev || 'Quiet'}</strong>
            </div>
            <div class="globe-tooltip-row">
              <span>Reports</span>
              <strong>${count}</strong>
            </div>`;
        }
      } else if (storyData) {
        const meta = getSeverityMeta(storyData.severity);
        const articleCount = storyData.articleCount || 1;
        html = `
          <div class="globe-tooltip-name">${storyData.title}</div>
          <div class="globe-tooltip-row">
            <span>${storyData.locality || ''}</span>
            <strong style="color:${meta.accent}">${meta.label}</strong>
          </div>
          <div class="globe-tooltip-row">
            <span>Sources</span>
            <strong>${articleCount}</strong>
          </div>`;
      } else if (arcObj) {
        const meta = getSeverityMeta(arcObj.severity);
        const typeColor = arcObj.type === 'shared-actor' ? '#00d4ff' : arcObj.type === 'causal-flow' ? '#ffaa00' : '#ffffff';
        const typeLabel = arcObj.type === 'shared-actor' ? `Actor: ${arcObj.label || arcObj.category}`
          : arcObj.type === 'causal-flow' ? `Flow: ${arcObj.label || arcObj.category}`
          : arcObj.category;
        html = `
          <div class="globe-tooltip-name" style="color:${typeColor}">${typeLabel}</div>
          <div class="globe-tooltip-row">
            <span>${arcObj.startRegion || ''}</span>
            <strong>&harr;</strong>
            <span>${arcObj.endRegion || ''}</span>
          </div>
          <div class="globe-tooltip-row">
            <span>Severity</span>
            <strong style="color:${meta.accent}">${meta.label} &middot; ${arcObj.severity}</strong>
          </div>`;
      }

      if (!html) {
        tooltip.style.display = 'none';
        return;
      }

      tooltip.innerHTML = html;
      tooltip.style.display = 'block';

      // Position tooltip at the entity's screen position
      const position = hoveredEntity.position?.getValue?.(Cesium.JulianDate.now());
      if (position) {
        const windowPos = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, position);
        if (windowPos) {
          tooltip.style.left = windowPos.x + 'px';
          tooltip.style.top = windowPos.y + 'px';
        }
      } else {
        // For polygons, use the cursor position - hide positioning
        // We'll use a simpler approach: track cursor in mouse move
      }
    };

    // Run tooltip positioning each frame for smooth tracking
    viewer.scene.postRender.addEventListener(updateTooltip);
    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.scene.postRender.removeEventListener(updateTooltip);
      }
    };
  }, [hoveredEntity, mapOverlay, regionSeverities, coverageStatusByIso]);

  /* ── Track cursor position for polygon tooltip positioning ── */
  useEffect(() => {
    const viewer = viewerRef.current;
    const tooltip = tooltipRef.current;
    if (!viewer || !tooltip) return;

    const onMove = (e) => {
      if (!hoveredEntity) return;
      // Only reposition for entities without a world position (polygons)
      const position = hoveredEntity.position?.getValue?.(Cesium.JulianDate.now());
      if (!position) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          tooltip.style.left = (e.clientX - rect.left) + 'px';
          tooltip.style.top = (e.clientY - rect.top - 12) + 'px';
        }
      }
    };

    const canvas = viewer.canvas;
    canvas.addEventListener('mousemove', onMove);
    return () => canvas.removeEventListener('mousemove', onMove);
  }, [hoveredEntity]);

  /* ── Resize handling ── */
  useEffect(() => {
    const viewer = viewerRef.current;
    const node = containerRef.current;
    if (!viewer || !node) return;

    const ro = new ResizeObserver(() => {
      viewer.resize();
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="globe-wrapper cesium-globe-active"
      style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, overflow: 'hidden', zIndex: 0 }}
    />
  );
};

export default CesiumGlobe;
