import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Tooltip, Popup, useMap } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import countriesUrl from '../assets/ne_110m_admin_0_countries.geojson?url';
import { getSeverityMeta } from '../utils/mockData';
import { getCoverageMeta } from '../utils/coverageMeta';
import { getConfidenceReasonLabel } from '../utils/confidenceReasons';
import { normalizeArticleText } from '../utils/articleText';
import ExpandableText from './ExpandableText';

const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';
const LANGUAGE_LABELS = {
  en: 'EN',
  es: 'ES',
  fr: 'FR',
  ar: 'AR',
  zh: 'ZH'
};
const LOCATION_SIGNAL_KEYS = {
  'title-city': 'titleCity',
  'title-country': 'titleCountry',
  'title-country-conflict': 'titleCountryConflict',
  'summary-city': 'summaryCity',
  'summary-city-confirmed': 'summaryCityConfirmed',
  'summary-country': 'summaryCountry',
  'summary-country-conflict': 'summaryCountryConflict',
  'source-country': 'sourceCountry'
};

const getIso = (f) => {
  const iso = f?.properties?.ISO_A2;
  if (iso && iso !== '-99') return iso;
  return f?.properties?.WB_A2 || f?.properties?.ADM0_A3_US || null;
};

// Sync map view with selected story/region
const MapController = ({ selectedStory, selectedRegion, regionSeverities, newsList }) => {
  const map = useMap();
  const prevStoryRef = useRef(null);
  const prevRegionRef = useRef(null);

  // Invalidate map size when container resizes (e.g. sidebar open/close)
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: true, pan: false });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  useEffect(() => {
    if (selectedStory && selectedStory.id !== prevStoryRef.current) {
      map.flyTo([selectedStory.coordinates[0], selectedStory.coordinates[1]], 8, { duration: 1.2 });
      prevStoryRef.current = selectedStory.id;
      return;
    }

    if (selectedRegion && selectedRegion !== prevRegionRef.current) {
      const focal = regionSeverities[selectedRegion]?.peakStory
        || newsList.find((s) => s.isoA2 === selectedRegion);
      if (focal) {
        map.flyTo([focal.coordinates[0], focal.coordinates[1]], 5, { duration: 1.2 });
      }
      prevRegionRef.current = selectedRegion;
      return;
    }

    if (!selectedStory && !selectedRegion) {
      prevStoryRef.current = null;
      prevRegionRef.current = null;
    }
  }, [map, selectedStory, selectedRegion, regionSeverities, newsList]);

  return null;
};

const FlatMap = ({
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
  const [countries, setCountries] = useState(null);
  const [hoveredIso, setHoveredIso] = useState(null);
  const [tileUrl, setTileUrl] = useState(() => (
    document.documentElement.getAttribute('data-theme') === 'light' ? TILE_LIGHT : TILE_DARK
  ));

  // Watch for theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const theme = document.documentElement.getAttribute('data-theme');
      setTileUrl(theme === 'light' ? TILE_LIGHT : TILE_DARK);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  const geoJsonRef = useRef(null);

  // Disable hover on touch devices
  const isTouchDevice = useMemo(() => (
    typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
      && typeof screen !== 'undefined' && screen.width < 768
  ), []);

  // Fetch country GeoJSON
  useEffect(() => {
    fetch(countriesUrl)
      .then((r) => r.json())
      .then(setCountries)
      .catch(() => {});
  }, []);

  // Style each country polygon based on severity
  const countryStyle = useCallback((feature) => {
    const iso = getIso(feature);
    const regionData = iso ? regionSeverities[iso] : null;
    const coverageEntry = iso ? coverageStatusByIso[iso] : null;
    const coverageMeta = getCoverageMeta(coverageEntry?.status || 'uncovered');
    const isHovered = iso === hoveredIso;
    const isSelected = iso === selectedRegion;

    if (mapOverlay === 'coverage') {
      return {
        fillColor: coverageMeta.accent,
        fillOpacity: isSelected ? 0.42 : isHovered ? 0.3 : coverageEntry ? 0.2 : 0.08,
        color: isSelected ? '#ffffff' : isHovered ? coverageMeta.accent : coverageMeta.stroke,
        weight: isSelected ? 2 : isHovered ? 1.5 : 0.8,
        opacity: 1,
      };
    }

    if (regionData) {
      const meta = getSeverityMeta(regionData.peakSeverity);
      return {
        fillColor: meta.accent,
        fillOpacity: isSelected ? 0.45 : isHovered ? 0.35 : 0.2,
        color: isSelected ? meta.accent : isHovered ? meta.accent : 'rgba(255,255,255,0.08)',
        weight: isSelected ? 2 : isHovered ? 1.5 : 0.5,
        opacity: 1,
      };
    }

    // No news for this country
    return {
      fillColor: isHovered ? 'rgba(255,255,255,0.15)' : coverageMeta.accent,
      fillOpacity: isSelected ? 0.2 : isHovered ? 0.12 : 0.04,
      color: isSelected ? 'rgba(255,255,255,0.4)' : isHovered ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)',
      weight: isSelected ? 1.5 : isHovered ? 1 : 0.5,
      opacity: 1,
    };
  }, [coverageStatusByIso, hoveredIso, mapOverlay, regionSeverities, selectedRegion]);

  // Handlers for each country feature
  const onEachCountry = useCallback((feature, layer) => {
    const iso = getIso(feature);
    const regionData = iso ? regionSeverities[iso] : null;
    const coverageEntry = iso ? coverageStatusByIso[iso] : null;
    const coverageMeta = getCoverageMeta(coverageEntry?.status || 'uncovered');
    const name = feature.properties?.NAME || feature.properties?.ADMIN || iso;

    if (mapOverlay === 'coverage') {
      const sourceFeedLabel = coverageEntry?.feedCount
        ? `${coverageEntry.healthyFeeds + coverageEntry.emptyFeeds}/${coverageEntry.feedCount} ${t('map.sourceFeeds')}`
        : t('map.noLocalFeeds');
      layer.bindTooltip(
        `<strong>${name}</strong><br/><span style="color:${coverageMeta.accent}">${t(`coverageStatus.${coverageMeta.labelKey}`)}</span>${coverageEntry?.eventCount ? ` · ${coverageEntry.maxConfidence}%` : ''}<br/>${sourceFeedLabel}`,
        {
          className: 'flatmap-tooltip',
          direction: 'top',
          sticky: true,
        }
      );
    } else if (regionData) {
      const meta = getSeverityMeta(regionData.peakSeverity);
      layer.bindTooltip(
        `<strong>${name}</strong><br/><span style="color:${meta.accent}">${meta.label}</span> · ${regionData.count} ${t('header.stories')}`,
        {
          className: 'flatmap-tooltip',
          direction: 'top',
          sticky: true,
        }
      );
    }

    const events = {
      click: () => {
        if (iso) onRegionSelect(iso);
      },
    };
    if (!isTouchDevice) {
      events.mouseover = () => setHoveredIso(iso);
      events.mouseout = () => setHoveredIso(null);
    }
    layer.on(events);
  }, [coverageStatusByIso, isTouchDevice, mapOverlay, onRegionSelect, regionSeverities, t]);

  // Force GeoJSON re-render when styles change
  const geoJsonKey = useMemo(() => {
    const sevKeys = Object.entries(regionSeverities)
      .sort(([leftIso], [rightIso]) => leftIso.localeCompare(rightIso))
      .map(([iso, entry]) => `${iso}:${entry.peakSeverity}:${entry.count}`)
      .join('|');
    const coverageKeys = Object.entries(coverageStatusByIso)
      .sort(([leftIso], [rightIso]) => leftIso.localeCompare(rightIso))
      .map(([iso, entry]) => `${iso}:${entry.status}:${entry.maxConfidence}`)
      .join('|');
    return `${mapOverlay}-${sevKeys}-${coverageKeys}-${selectedRegion}-${hoveredIso}`;
  }, [coverageStatusByIso, hoveredIso, mapOverlay, regionSeverities, selectedRegion]);

  // Article dot markers
  const markers = useMemo(() => {
    return newsList.map((story) => {
      const meta = getSeverityMeta(story.severity);
      return { ...story, meta };
    });
  }, [newsList]);

  return (
    <div className="flatmap-wrapper">
      <MapContainer
        center={[20, 10]}
        zoom={3}
        minZoom={2}
        maxZoom={18}
        zoomControl={false}
        tap={false}
        zoomAnimation
        fadeAnimation
        markerZoomAnimation
        className="flatmap-container"
        worldCopyJump
      >
        <TileLayer key={tileUrl} url={tileUrl} attribution={TILE_ATTRIBUTION} />

        <MapController
          selectedStory={selectedStory}
          selectedRegion={selectedRegion}
          regionSeverities={regionSeverities}
          newsList={newsList}
        />

        {/* Country polygons colored by severity */}
        {countries && (
          <GeoJSON
            key={geoJsonKey}
            ref={geoJsonRef}
            data={countries}
            style={countryStyle}
            onEachFeature={onEachCountry}
          />
        )}

        {/* Individual article dots */}
        {markers.map((story) => {
          const isSelected = selectedStory?.id === story.id;
          const languages = (story.languages || [story.language])
            .filter((language) => language && language !== 'unknown')
            .map((language) => LANGUAGE_LABELS[language] || language.toUpperCase());
          const sourceTypes = (story.sourceTypes || [story.sourceType])
            .filter(Boolean)
            .map((type) => t(`sourceType.${type}`));
          const confidenceReasons = (story.confidenceReasons || [])
            .map((reason) => ({
              key: `${story.id}-${reason.type}`,
              tone: reason.tone || 'positive',
              label: getConfidenceReasonLabel(t, reason)
            }))
            .filter((reason) => reason.label);
          const normalizedTitle = normalizeArticleText(story.title);
          const normalizedSummary = normalizeArticleText(story.summary);
          const hasDistinctSummary = normalizedSummary && normalizedSummary !== normalizedTitle;
          const evidence = (story.supportingArticles || [])
            .filter((article, index, arr) => (
              arr.findIndex((candidate) => (candidate.url || `${candidate.source}-${candidate.title}`) === (article.url || `${article.source}-${article.title}`)) === index
            ))
            .slice(0, 3);
          return (
            <CircleMarker
              key={story.id}
              center={[story.coordinates[0], story.coordinates[1]]}
              radius={isSelected ? 7 : 3.5}
              pathOptions={{
                fillColor: isSelected ? '#ffffff' : story.meta.accent,
                fillOpacity: isSelected ? 1 : 0.8,
                color: isSelected ? '#ffffff' : story.meta.accent,
                weight: isSelected ? 2 : 0.8,
                opacity: 0.9,
                className: isSelected ? 'flatmap-marker-selected' : ''
              }}
              eventHandlers={{
                click: () => onStorySelect(story)
              }}
            >
              <Tooltip
                direction="top"
                offset={[0, -6]}
                className="flatmap-tooltip"
              >
                <strong>{story.title}</strong>
                <br />
                <span style={{ color: story.meta.accent }}>{story.meta.label}</span>
                {' · '}
                {story.locality}
              </Tooltip>

              <Popup className="flatmap-popup">
                <div className="flatmap-popup-content">
                  <div
                    className="flatmap-popup-severity"
                    style={{ background: story.meta.muted, color: story.meta.accent }}
                  >
                    {story.meta.label}
                  </div>
                  <h3>{story.title}</h3>
                  {hasDistinctSummary && (
                    <ExpandableText
                      text={story.summary}
                      collapsedLength={240}
                      className="flatmap-popup-summary"
                      textClassName="flatmap-popup-summary-copy"
                      buttonClassName="flatmap-popup-summary-toggle"
                    />
                  )}
                  <div className="flatmap-popup-meta">
                    <span>{story.locality}</span>
                    <span>{story.category}</span>
                    {story.source && <span>{story.source}</span>}
                  </div>
                  <div className="flatmap-popup-detail-row">
                    <span>{t('article.verification')}</span>
                    <strong>{t(`article.verificationStatus.${story.verificationStatus || 'single-source'}`)}</strong>
                  </div>
                  <div className="flatmap-popup-detail-row">
                    <span>{t('article.confidence')}</span>
                    <strong>{story.confidence ?? 0}%</strong>
                  </div>
                  {confidenceReasons.length > 0 && (
                    <div className="flatmap-popup-evidence">
                      <div className="flatmap-popup-evidence-label">{t('article.confidenceSignals')}</div>
                      <div className="flatmap-popup-chip-row">
                        {confidenceReasons.map((reason) => (
                          <span
                            key={reason.key}
                            className={`flatmap-popup-chip ${reason.tone === 'warning' ? 'is-warning' : 'is-positive'}`}
                          >
                            {reason.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flatmap-popup-detail-row">
                    <span>{t('article.locationPrecision')}</span>
                    <strong>{t(`precision.${story.geocodePrecision || 'unknown'}`)}</strong>
                  </div>
                  {story.geocodeMatchedOn && (
                    <div className="flatmap-popup-detail-row">
                      <span>{t('article.locationSignal')}</span>
                      <strong>{t(`article.locationSignalType.${LOCATION_SIGNAL_KEYS[story.geocodeMatchedOn] || 'sourceCountry'}`)}</strong>
                    </div>
                  )}
                  <div className="flatmap-popup-detail-row">
                    <span>{t('article.independentSources')}</span>
                    <strong>{story.independentSourceCount ?? story.sourceCount ?? 1}</strong>
                  </div>
                  {(sourceTypes.length > 0 || languages.length > 0) && (
                    <div className="flatmap-popup-chip-groups">
                      {sourceTypes.length > 0 && (
                        <div className="flatmap-popup-chip-row">
                          {sourceTypes.map((type) => (
                            <span key={type} className="flatmap-popup-chip">{type}</span>
                          ))}
                        </div>
                      )}
                      {languages.length > 0 && (
                        <div className="flatmap-popup-chip-row">
                          {languages.map((language) => (
                            <span key={language} className="flatmap-popup-chip">{language}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {evidence.length > 0 && (
                    <div className="flatmap-popup-evidence">
                      <div className="flatmap-popup-evidence-label">{t('article.evidence')}</div>
                      {evidence.map((item) => (
                        item.url ? (
                          <a
                            key={item.url || `${item.source}-${item.title}`}
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flatmap-popup-evidence-item"
                          >
                            <span>{item.source || t('article.source')}</span>
                          </a>
                        ) : (
                          <div
                            key={`${item.source}-${item.title}`}
                            className="flatmap-popup-evidence-item is-static"
                          >
                            <span>{item.source || t('article.source')}</span>
                          </div>
                        )
                      ))}
                    </div>
                  )}
                  {story.url && (
                    <a
                      href={story.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flatmap-popup-link"
                    >
                      {t('article.readFull')}
                    </a>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
};

export default FlatMap;
