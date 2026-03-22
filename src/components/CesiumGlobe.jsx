import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import countriesUrl from '../assets/ne_110m_admin_0_countries.geojson?url';
import { getSeverityMeta } from '../utils/mockData';
import { getCoverageMeta } from '../utils/coverageMeta';
import { isoToCountry, areCountriesAdjacent } from '../utils/geocoder';

// No Ion token needed
Cesium.Ion.defaultAccessToken = undefined;

const ARC_TYPE_COLORS = {
  'same-event': Cesium.Color.WHITE.withAlpha(0.5),
  'shared-actor': Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.5),
  'causal-flow': Cesium.Color.fromCssColorString('#ffaa00').withAlpha(0.5),
};

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
  const [hoveredIso, setHoveredIso] = useState(null);

  // ── Initialize Cesium Viewer ──
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

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
      skyBox: false,
      skyAtmosphere: false,
      contextOptions: { webgl: { alpha: false } }
    });

    // Dark theme — remove all imagery, set dark base
    viewer.scene.imageryLayers.removeAll();
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#050810');
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#070c14');
    viewer.scene.globe.showGroundAtmosphere = false;
    viewer.scene.globe.enableLighting = false;
    if (viewer.scene.sun) viewer.scene.sun.show = false;
    if (viewer.scene.moon) viewer.scene.moon.show = false;
    if (viewer.scene.fog) viewer.scene.fog.enabled = false;
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;

    // Initial camera
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(10, 20, 18000000),
      duration: 0
    });

    // Click handler
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    handler.setInputAction((e) => {
      const picked = viewer.scene.pick(e.position);
      if (Cesium.defined(picked) && picked.id) {
        const iso = getIso(picked.id);
        if (iso) { onRegionSelect(iso); return; }
        const storyId = picked.id._storyId;
        if (storyId) {
          const story = newsList.find(s => s.id === storyId);
          if (story) onStorySelect(story);
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Hover handler
    handler.setInputAction((e) => {
      const picked = viewer.scene.pick(e.endPosition);
      if (Cesium.defined(picked) && picked.id) {
        const iso = getIso(picked.id);
        if (iso) {
          setHoveredIso(iso);
          viewer.canvas.style.cursor = 'pointer';
          return;
        }
      }
      setHoveredIso(null);
      viewer.canvas.style.cursor = 'default';
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    viewerRef.current = viewer;

    return () => {
      handler.destroy();
      if (!viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // Update click/hover handlers when callbacks change
  const callbacksRef = useRef({ onRegionSelect, onStorySelect, newsList });
  callbacksRef.current = { onRegionSelect, onStorySelect, newsList };

  // ── Load country GeoJSON ──
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    Cesium.GeoJsonDataSource.load(countriesUrl, {
      stroke: Cesium.Color.CYAN.withAlpha(0.3),
      strokeWidth: 1.5,
      fill: Cesium.Color.CYAN.withAlpha(0.06),
      clampToGround: true
    }).then(ds => {
      countryDsRef.current = ds;
      viewer.dataSources.add(ds);
    });
  }, []);

  // ── Color polygons when data changes ──
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
        outline = isSel ? Cesium.Color.CYAN.withAlpha(0.8) : isHov ? cssToColor(cm.stroke) : cssToColor(cm.stroke);
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
    }
  }, [regionSeverities, coverageStatusByIso, mapOverlay, selectedRegion, hoveredIso]);

  // ── Event markers ──
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    // Remove old marker datasource
    if (markerDsRef.current) {
      viewer.dataSources.remove(markerDsRef.current, true);
    }

    const ds = new Cesium.CustomDataSource('markers');
    markerDsRef.current = ds;

    for (const story of newsList) {
      if (!story.coordinates) continue;
      const meta = getSeverityMeta(story.severity);
      const size = Math.min(18, 7 + (story.articleCount || 1) * 1.5);
      const isSelected = selectedStory?.id === story.id;

      const entity = ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(story.coordinates[1], story.coordinates[0]),
        point: {
          pixelSize: isSelected ? 16 : size,
          color: isSelected ? Cesium.Color.WHITE : cssToColor(meta.accent, 1.0),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
          outlineWidth: 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
      entity._storyId = story.id;
    }

    viewer.dataSources.add(ds);
  }, [newsList, selectedStory]);

  // ── Arc lines ──
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (arcDsRef.current) {
      viewer.dataSources.remove(arcDsRef.current, true);
    }

    const ds = new Cesium.CustomDataSource('arcs');
    arcDsRef.current = ds;

    const seen = new Set();
    const countryStoryMap = {};
    for (const story of newsList) {
      if (!story.coordinates || !story.isoA2) continue;
      if (!countryStoryMap[story.isoA2] || story.severity > countryStoryMap[story.isoA2].severity) {
        countryStoryMap[story.isoA2] = story;
      }
    }

    const addArc = (isoA, isoB, severity, type = 'same-event') => {
      if (isoA === isoB) return;
      const key = [isoA, isoB].sort().join('-');
      if (seen.has(key)) return;
      const a = countryStoryMap[isoA];
      const b = countryStoryMap[isoB];
      if (!a || !b) return;
      seen.add(key);

      const color = ARC_TYPE_COLORS[type] || ARC_TYPE_COLORS['same-event'];
      const width = Math.max(1, Math.min(3, severity / 25));

      ds.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArrayHeights([
            a.coordinates[1], a.coordinates[0], 20000,
            (a.coordinates[1] + b.coordinates[1]) / 2, (a.coordinates[0] + b.coordinates[0]) / 2, 200000 + severity * 2500,
            b.coordinates[1], b.coordinates[0], 20000
          ]),
          width,
          material: color,
          arcType: Cesium.ArcType.NONE
        }
      });
    };

    // Same-event arcs
    for (const story of newsList) {
      if (!Array.isArray(story.countries) || story.countries.length < 2) continue;
      for (let i = 0; i < story.countries.length; i++) {
        for (let j = i + 1; j < story.countries.length; j++) {
          addArc(story.countries[i], story.countries[j], story.severity, 'same-event');
        }
      }
    }

    // Shared-actor arcs
    const entityMap = {};
    for (const story of newsList) {
      if (!story.isoA2) continue;
      for (const org of (story.entities?.organizations || [])) {
        if (!entityMap[org.name]) entityMap[org.name] = [];
        entityMap[org.name].push({ iso: story.isoA2, severity: story.severity });
      }
    }
    for (const [, occs] of Object.entries(entityMap)) {
      const unique = [...new Set(occs.map(o => o.iso))];
      if (unique.length >= 2) {
        addArc(unique[0], unique[1], Math.max(...occs.map(o => o.severity || 0)), 'shared-actor');
      }
    }

    viewer.dataSources.add(ds);
  }, [newsList]);

  // ── Camera fly-to on selection ──
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (selectedStory?.coordinates) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(selectedStory.coordinates[1], selectedStory.coordinates[0], 4000000),
        duration: 1.2
      });
    } else if (selectedRegion) {
      const focal = regionSeverities[selectedRegion]?.peakStory
        || newsList.find(s => s.isoA2 === selectedRegion);
      if (focal?.coordinates) {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(focal.coordinates[1], focal.coordinates[0], 6000000),
          duration: 1.2
        });
      }
    }
  }, [selectedRegion, selectedStory]);

  // ── Resize handling ──
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
      className="globe-wrapper"
      style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
    />
  );
};

export default CesiumGlobe;
