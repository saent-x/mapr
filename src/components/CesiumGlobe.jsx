import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Viewer, Entity, GeoJsonDataSource, CameraFlyTo, Globe as CesiumGlobeComponent,
  ScreenSpaceEventHandler, ScreenSpaceEvent
} from 'resium';
import {
  Ion, Color, Cartesian3, Math as CesiumMath, ScreenSpaceEventType,
  GeoJsonDataSource as CesiumGeoJsonDataSource, defined,
  ConstantProperty, ColorMaterialProperty, ArcType,
  EllipsoidTerrainProvider, ImageryLayer
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import countriesUrl from '../assets/ne_110m_admin_0_countries.geojson?url';
import { getSeverityMeta } from '../utils/mockData';
import { getCoverageMeta } from '../utils/coverageMeta';
import { isoToCountry, areCountriesAdjacent } from '../utils/geocoder';

// Disable Cesium Ion (we don't use it)
Ion.defaultAccessToken = undefined;

const ARC_COLORS_MAP = {
  'same-event': Color.WHITE.withAlpha(0.6),
  'shared-actor': Color.fromCssColorString('#00d4ff').withAlpha(0.6),
  'causal-flow': Color.fromCssColorString('#ffaa00').withAlpha(0.6),
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

function cssToColor(cssColor, alpha = 1) {
  try {
    return Color.fromCssColorString(cssColor).withAlpha(alpha);
  } catch {
    return Color.CYAN.withAlpha(0.1);
  }
}

function getIso(entity) {
  const props = entity?.properties;
  if (!props) return null;
  const iso = props.ISO_A2?.getValue?.() ?? props.ISO_A2;
  if (iso && iso !== '-99') return iso;
  return props.WB_A2?.getValue?.() ?? props.ADM0_A3_US?.getValue?.() ?? null;
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
  const viewerRef = useRef(null);
  const dataSourceRef = useRef(null);
  const [hoveredIso, setHoveredIso] = useState(null);
  const containerRef = useRef(null);

  // Load and color country polygons
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;

    // Remove old datasource
    if (dataSourceRef.current) {
      viewer.dataSources.remove(dataSourceRef.current, true);
    }

    CesiumGeoJsonDataSource.load(countriesUrl, {
      stroke: Color.CYAN.withAlpha(0.15),
      strokeWidth: 1,
      fill: Color.CYAN.withAlpha(0.02),
      clampToGround: true
    }).then((ds) => {
      dataSourceRef.current = ds;
      viewer.dataSources.add(ds);
      colorPolygons(ds);
    });

    return () => {
      if (dataSourceRef.current && viewer && !viewer.isDestroyed()) {
        viewer.dataSources.remove(dataSourceRef.current, true);
      }
    };
  }, []);

  // Re-color polygons when data or overlay changes
  const colorPolygons = useCallback((ds) => {
    if (!ds) return;
    const entities = ds.entities.values;
    for (const entity of entities) {
      const iso = getIso(entity);
      if (!iso || !entity.polygon) continue;

      const sev = regionSeverities[iso]?.averageSeverity || 0;
      const isSel = iso === selectedRegion;
      const isHov = iso === hoveredIso;
      const isCoverage = mapOverlay === 'coverage';

      let fillColor;
      let outlineColor = Color.CYAN.withAlpha(0.07);

      if (isCoverage) {
        const status = coverageStatusByIso[iso]?.status || 'uncovered';
        const cm = getCoverageMeta(status);
        fillColor = isSel ? cssToColor(cm.selectedFill) : isHov ? cssToColor(cm.hoverFill) : cssToColor(cm.fill);
        outlineColor = isSel ? Color.CYAN.withAlpha(0.6) : isHov ? cssToColor(cm.stroke) : cssToColor(cm.stroke);
      } else {
        if (sev) {
          const meta = getSeverityMeta(sev);
          const alpha = 0.08 + (sev / 100) * 0.14;
          fillColor = (isSel || isHov) ? cssToColor(meta.mapFill) : cssToColor(meta.accent, alpha);
        } else {
          fillColor = isSel ? Color.CYAN.withAlpha(0.15) : isHov ? Color.CYAN.withAlpha(0.08) : Color.CYAN.withAlpha(0.02);
        }
        if (isSel) outlineColor = Color.CYAN.withAlpha(0.6);
        else if (isHov) outlineColor = Color.CYAN.withAlpha(0.35);
      }

      entity.polygon.material = new ColorMaterialProperty(fillColor);
      entity.polygon.outline = new ConstantProperty(true);
      entity.polygon.outlineColor = new ConstantProperty(outlineColor);
      entity.polygon.outlineWidth = new ConstantProperty(isSel ? 2 : 1);
    }
  }, [regionSeverities, coverageStatusByIso, mapOverlay, selectedRegion, hoveredIso]);

  // Apply colors when dependencies change
  useEffect(() => {
    if (dataSourceRef.current) {
      colorPolygons(dataSourceRef.current);
    }
  }, [colorPolygons]);

  // Set dark theme + initial view
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;

    // Dark background
    viewer.scene.backgroundColor = Color.fromCssColorString('#060a12');
    viewer.scene.globe.baseColor = Color.fromCssColorString('#0a1020');
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.globe.enableLighting = false;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.fog.enabled = false;
    viewer.scene.sun.show = false;
    viewer.scene.moon.show = false;
    viewer.scene.skyBox.show = false;

    // Remove all default imagery layers for a clean dark globe
    viewer.scene.imageryLayers.removeAll();

    // Initial camera position
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(10, 20, 15000000),
      duration: 0
    });
  }, []);

  // Event markers
  const eventMarkers = useMemo(() => {
    return newsList.filter(s => s.coordinates).map(story => {
      const meta = getSeverityMeta(story.severity);
      const size = Math.min(16, 6 + (story.articleCount || 1) * 1.5);
      return {
        ...story,
        _color: cssToColor(meta.accent, 0.9),
        _size: size
      };
    });
  }, [newsList]);

  // Arc data
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

    const addArc = (isoA, isoB, severity, type = 'same-event', label = null) => {
      if (isoA === isoB) return;
      const key = [isoA, isoB].sort().join('-');
      if (seen.has(key)) return;
      const a = countryStoryMap[isoA];
      const b = countryStoryMap[isoB];
      if (!a || !b) return;
      seen.add(key);
      arcs.push({
        id: key,
        positions: [
          Cartesian3.fromDegrees(a.coordinates[1], a.coordinates[0], 50000),
          Cartesian3.fromDegrees(
            (a.coordinates[1] + b.coordinates[1]) / 2,
            (a.coordinates[0] + b.coordinates[0]) / 2,
            300000 + severity * 3000
          ),
          Cartesian3.fromDegrees(b.coordinates[1], b.coordinates[0], 50000)
        ],
        color: ARC_COLORS_MAP[type] || ARC_COLORS_MAP['same-event'],
        width: Math.max(1, severity / 30),
        type, label, severity,
        startIso: isoA, endIso: isoB,
        startRegion: a.region, endRegion: b.region
      });
    };

    // Same-event arcs
    for (const story of newsList) {
      const countries = story.countries;
      if (!Array.isArray(countries) || countries.length < 2) continue;
      for (let i = 0; i < countries.length; i++) {
        for (let j = i + 1; j < countries.length; j++) {
          addArc(countries[i], countries[j], story.severity, 'same-event');
        }
      }
    }

    // Shared-actor arcs
    const entityCountryMap = {};
    for (const story of newsList) {
      if (!story.isoA2) continue;
      for (const org of (story.entities?.organizations || [])) {
        if (!entityCountryMap[org.name]) entityCountryMap[org.name] = [];
        entityCountryMap[org.name].push({ iso: story.isoA2, severity: story.severity });
      }
    }
    for (const [name, occs] of Object.entries(entityCountryMap)) {
      const unique = [...new Set(occs.map(o => o.iso))];
      if (unique.length >= 2) {
        addArc(unique[0], unique[1], Math.max(...occs.map(o => o.severity || 0)), 'shared-actor', name);
      }
    }

    return arcs.sort((a, b) => b.severity - a.severity).slice(0, 30);
  }, [newsList]);

  // Handle click on globe
  const handleClick = useCallback((e) => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;
    const picked = viewer.scene.pick(e.position);
    if (defined(picked) && picked.id) {
      const entity = picked.id;
      // Check if it's a country polygon
      const iso = getIso(entity);
      if (iso) {
        onRegionSelect(iso);
        return;
      }
      // Check if it's an event marker
      if (entity._storyId) {
        const story = newsList.find(s => s.id === entity._storyId);
        if (story) onStorySelect(story);
      }
    }
  }, [newsList, onRegionSelect, onStorySelect]);

  // Handle hover
  const handleMouseMove = useCallback((e) => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;
    const picked = viewer.scene.pick(e.endPosition);
    if (defined(picked) && picked.id) {
      const iso = getIso(picked.id);
      if (iso && iso !== hoveredIso) {
        setHoveredIso(iso);
        viewer.canvas.style.cursor = 'pointer';
      }
    } else {
      if (hoveredIso) setHoveredIso(null);
      viewer.canvas.style.cursor = 'default';
    }
  }, [hoveredIso]);

  // Camera fly-to on selection
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;

    if (selectedStory?.coordinates) {
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(selectedStory.coordinates[1], selectedStory.coordinates[0], 3000000),
        duration: 1.2
      });
    } else if (selectedRegion) {
      const focal = regionSeverities[selectedRegion]?.peakStory
        || newsList.find(s => s.isoA2 === selectedRegion);
      if (focal?.coordinates) {
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(focal.coordinates[1], focal.coordinates[0], 5000000),
          duration: 1.2
        });
      }
    }
  }, [selectedRegion, selectedStory, regionSeverities, newsList]);

  return (
    <div ref={containerRef} className="globe-wrapper" style={{ width: '100%', height: '100%' }}>
      <Viewer
        ref={viewerRef}
        full
        timeline={false}
        animation={false}
        homeButton={false}
        sceneModePicker={false}
        baseLayerPicker={false}
        navigationHelpButton={false}
        geocoder={false}
        fullscreenButton={false}
        infoBox={false}
        selectionIndicator={false}
        creditContainer={document.createElement('div')}
        terrainProvider={new EllipsoidTerrainProvider()}
        style={{ width: '100%', height: '100%' }}
      >
        <CesiumGlobeComponent
          enableLighting={false}
          showGroundAtmosphere={true}
          baseColor={Color.fromCssColorString('#0a1020')}
        />

        <ScreenSpaceEventHandler>
          <ScreenSpaceEvent action={handleClick} type={ScreenSpaceEventType.LEFT_CLICK} />
          <ScreenSpaceEvent action={handleMouseMove} type={ScreenSpaceEventType.MOUSE_MOVE} />
        </ScreenSpaceEventHandler>

        {/* Event markers */}
        {eventMarkers.map(story => (
          <Entity
            key={story.id}
            position={Cartesian3.fromDegrees(story.coordinates[1], story.coordinates[0], 0)}
            point={{
              pixelSize: story._size,
              color: story._color,
              outlineColor: Color.BLACK.withAlpha(0.3),
              outlineWidth: 1,
              disableDepthTestDistance: Number.POSITIVE_INFINITY
            }}
            description={`
              <div style="font-family:monospace;color:#ccc;background:#0d1117;padding:8px;font-size:12px;">
                <strong>${story.title}</strong><br/>
                Severity: ${story.severity} · Sources: ${story.articleCount || 1}
                ${story.lifecycle ? `<br/>Lifecycle: ${story.lifecycle}` : ''}
              </div>
            `}
            properties={{ _storyId: story.id }}
          />
        ))}

        {/* Arc lines */}
        {arcData.map(arc => (
          <Entity
            key={arc.id}
            polyline={{
              positions: arc.positions,
              width: arc.width,
              material: arc.color,
              arcType: ArcType.NONE
            }}
          />
        ))}
      </Viewer>
    </div>
  );
};

export default CesiumGlobe;
