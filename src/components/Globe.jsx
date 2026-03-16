import React, { useEffect, useMemo, useRef, useState } from 'react';
import GlobeGL from 'react-globe.gl';
import { useTranslation } from 'react-i18next';
import countriesUrl from '../assets/ne_110m_admin_0_countries.geojson?url';
import earthTexture from '../assets/earth-night.jpg';
import skyTexture from '../assets/night-sky.png';
import { getSeverityMeta } from '../utils/mockData';
import { getCoverageMeta } from '../utils/coverageMeta';

const DEFAULT_VIEW = { lat: 20, lng: 10, altitude: 2.2 };

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
  selectedRegion,
  selectedStory,
  onRegionSelect,
  onStorySelect
}) => {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const globeRef = useRef(null);
  const initRef = useRef(false);
  const dragRef = useRef({ down: false, moved: false, x: 0, y: 0 });

  const [countries, setCountries] = useState({ features: [] });
  const [hoveredCountry, setHoveredCountry] = useState(null);
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
    ctrl.autoRotateSpeed = 0.06;
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
        { lat: selectedStory.coordinates[0], lng: selectedStory.coordinates[1], altitude: 0.7 },
        1200
      );
      return;
    }

    if (selectedRegion) {
      const focal = regionSeverities[selectedRegion]?.peakStory
        || newsList.find((s) => s.isoA2 === selectedRegion);
      if (focal) {
        globeRef.current.pointOfView(
          { lat: focal.coordinates[0], lng: focal.coordinates[1], altitude: 0.9 },
          1200
        );
        return;
      }
    }

    globeRef.current.pointOfView(DEFAULT_VIEW, 1200);
  }, [newsList, regionSeverities, selectedRegion, selectedStory]);

  // Points: show all articles globally, highlight active region
  const activeRegion = selectedRegion || (hoveredCountry ? getIso(hoveredCountry) : null);

  const isActivePoint = (s) => s.isoA2 === activeRegion;

  // Rings: only for selected region / story
  const ringData = useMemo(() => {
    if (selectedStory) return [selectedStory];
    if (!selectedRegion) return [];
    return newsList.filter((s) => s.isoA2 === selectedRegion && s.severity >= 70).slice(0, 4);
  }, [newsList, selectedRegion, selectedStory]);

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
          atmosphereColor="#4a6fa1"
          atmosphereAltitude={0.18}

          /* === POLYGONS === */
          polygonsData={countries.features}

          polygonAltitude={(f) => {
            const iso = getIso(f);
            const sev = getRegionSev(f);
            const status = getCoverageStatus(f);
            const coverageMeta = getCoverageMeta(status);
            const isPassiveCoverage = status === 'uncovered' || status === 'source-sparse';
            const isHov = hoveredCountry && getIso(hoveredCountry) === iso;
            const isSel = iso === selectedRegion;

            if (mapOverlay === 'coverage') {
              if (isSel) return isPassiveCoverage ? 0.016 : 0.02;
              if (isHov) return isPassiveCoverage ? 0.01 : 0.013;
              return 0;
            }

            if (isSel) return sev ? Math.max(0.03, 0.01 + sev / 1200) : 0.02;
            if (isHov) return sev ? Math.max(0.02, 0.0075 + sev / 1600) : 0.0125;
            return 0;
          }}

          polygonCapColor={(f) => {
            const iso = getIso(f);
            const sev = getRegionSev(f);
            const coverageMeta = getCoverageMeta(getCoverageStatus(f));
            const isHov = hoveredCountry && getIso(hoveredCountry) === iso;
            const isSel = iso === selectedRegion;

            if (mapOverlay === 'coverage') {
              if (isSel) return coverageMeta.selectedFill;
              if (isHov) return coverageMeta.hoverFill;
              return coverageMeta.fill;
            }

            if (isSel && sev) return getSeverityMeta(sev).mapFill;
            if (isSel) return 'rgba(123, 138, 255, 0.18)';
            if (isHov && sev) return getSeverityMeta(sev).mapFill;
            if (isHov) return 'rgba(255, 255, 255, 0.07)';
            return 'rgba(255, 255, 255, 0.012)';
          }}

          polygonSideColor={(f) => {
            const iso = getIso(f);
            const sev = getRegionSev(f);
            const coverageMeta = getCoverageMeta(getCoverageStatus(f));
            const isHov = hoveredCountry && getIso(hoveredCountry) === iso;
            const isSel = iso === selectedRegion;

            if (mapOverlay === 'coverage') {
              if (isSel || isHov) return coverageMeta.side;
              return 'rgba(0, 0, 0, 0)';
            }

            if ((isSel || isHov) && sev) return getSeverityMeta(sev).mapSide;
            if (isSel || isHov) return 'rgba(255, 255, 255, 0.04)';
            return 'rgba(0, 0, 0, 0)';
          }}

          polygonStrokeColor={(f) => {
            const iso = getIso(f);
            const coverageMeta = getCoverageMeta(getCoverageStatus(f));
            if (iso === selectedRegion) return 'rgba(255, 255, 255, 0.45)';
            if (hoveredCountry && getIso(hoveredCountry) === iso) {
              return mapOverlay === 'coverage' ? coverageMeta.stroke : 'rgba(255, 255, 255, 0.2)';
            }
            if (mapOverlay === 'coverage') return coverageMeta.stroke;
            return 'rgba(255, 255, 255, 0.03)';
          }}

          polygonLabel={(f) => {
            const sev = Math.round(getRegionSev(f));
            const iso = getIso(f);
            const meta = getSeverityMeta(sev);
            const count = regionSeverities[iso]?.count || 0;
            const coverageEntry = getCoverageEntry(iso);
            const coverageMeta = getCoverageMeta(getCoverageStatus(f));
            const coverageCount = coverageEntry?.eventCount || 0;
            const confidence = coverageEntry?.maxConfidence || 0;
            const feedStatus = coverageEntry?.feedCount
              ? `${coverageEntry.healthyFeeds + coverageEntry.emptyFeeds}/${coverageEntry.feedCount}`
              : t('map.noLocalFeeds');

            if (mapOverlay === 'coverage') {
              return `
                <div class="globe-tooltip">
                  <div class="globe-tooltip-name">${f.properties.ADMIN}</div>
                  <div class="globe-tooltip-row">
                    <span>${t('map.status')}</span>
                    <strong style="color:${coverageMeta.accent}">${t(`coverageStatus.${coverageMeta.labelKey}`)}</strong>
                  </div>
                  <div class="globe-tooltip-row">
                    <span>${t('map.confidence')}</span>
                    <strong>${confidence ? `${confidence}%` : '—'}</strong>
                  </div>
                  <div class="globe-tooltip-row">
                    <span>${t('map.reports')}</span>
                    <strong>${coverageCount}</strong>
                  </div>
                  <div class="globe-tooltip-row">
                    <span>${t('map.sourceFeeds')}</span>
                    <strong>${feedStatus}</strong>
                  </div>
                </div>
              `;
            }

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

          /* === POINTS (all articles, highlighted for active region) === */
          pointsData={newsList}
          pointLat={(s) => s.coordinates[0]}
          pointLng={(s) => s.coordinates[1]}
          pointAltitude={(s) => {
            if (selectedStory?.id === s.id) return 0.015;
            if (isActivePoint(s)) return 0.0075 + s.severity / 2800;
            return 0.0025;
          }}
          pointRadius={(s) => {
            if (selectedStory?.id === s.id) return 0.35;
            if (isActivePoint(s)) return 0.12 + s.severity / 450;
            return 0.06 + s.severity / 900;
          }}
          pointColor={(s) => {
            if (selectedStory?.id === s.id) return '#ffffff';
            const meta = getSeverityMeta(s.severity);
            if (isActivePoint(s)) return meta.accent;
            return meta.muted;
          }}
          pointLabel={(s) => {
            if (!isActivePoint(s)) return '';
            const meta = getSeverityMeta(s.severity);
            return `
              <div class="globe-tooltip">
                <div class="globe-tooltip-name">${s.title}</div>
                <div class="globe-tooltip-row">
                  <span>${s.locality}</span>
                  <strong style="color:${meta.accent}">${meta.label}</strong>
                </div>
              </div>
            `;
          }}
          onPointClick={(s) => onStorySelect(s)}

          /* === RINGS (pulses on active region) === */
          ringsData={ringData}
          ringLat={(s) => s.coordinates[0]}
          ringLng={(s) => s.coordinates[1]}
          ringColor={(s) => {
            const meta = getSeverityMeta(s.severity);
            return [meta.ring, meta.muted, 'rgba(255,255,255,0)'];
          }}
          ringMaxRadius={(s) => 2 + s.severity / 24}
          ringPropagationSpeed={1.4}
          ringRepeatPeriod={1200}

          /* === TRANSITIONS === */
          polygonsTransitionDuration={350}
          pointsTransitionDuration={300}
        />
      )}
    </div>
  );
};

export default Globe;
