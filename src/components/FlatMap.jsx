import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Tooltip, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import countriesUrl from '../assets/ne_110m_admin_0_countries.geojson?url';
import { getSeverityMeta } from '../utils/mockData';

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

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
  selectedRegion,
  selectedStory,
  onRegionSelect,
  onStorySelect
}) => {
  const [countries, setCountries] = useState(null);
  const [hoveredIso, setHoveredIso] = useState(null);
  const geoJsonRef = useRef(null);

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
    const isHovered = iso === hoveredIso;
    const isSelected = iso === selectedRegion;

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
      fillColor: 'transparent',
      fillOpacity: 0,
      color: 'rgba(255,255,255,0.05)',
      weight: 0.5,
      opacity: 1,
    };
  }, [regionSeverities, selectedRegion, hoveredIso]);

  // Handlers for each country feature
  const onEachCountry = useCallback((feature, layer) => {
    const iso = getIso(feature);
    const regionData = iso ? regionSeverities[iso] : null;

    if (regionData) {
      const meta = getSeverityMeta(regionData.peakSeverity);
      const name = feature.properties?.NAME || feature.properties?.ADMIN || iso;
      layer.bindTooltip(
        `<strong>${name}</strong><br/><span style="color:${meta.accent}">${meta.label}</span> · ${regionData.count} stories`,
        {
          className: 'flatmap-tooltip',
          direction: 'top',
          sticky: true,
        }
      );
    }

    layer.on({
      mouseover: () => setHoveredIso(iso),
      mouseout: () => setHoveredIso(null),
      click: () => {
        if (iso) onRegionSelect(iso);
      },
    });
  }, [regionSeverities, onRegionSelect]);

  // Force GeoJSON re-render when styles change
  const geoJsonKey = useMemo(() => {
    const sevKeys = Object.keys(regionSeverities).sort().join(',');
    return `${sevKeys}-${selectedRegion}-${hoveredIso}`;
  }, [regionSeverities, selectedRegion, hoveredIso]);

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
        className="flatmap-container"
        worldCopyJump
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />

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
                  <p>{story.summary}</p>
                  <div className="flatmap-popup-meta">
                    <span>{story.locality}</span>
                    <span>{story.category}</span>
                    {story.source && <span>{story.source}</span>}
                  </div>
                  {story.url && (
                    <a
                      href={story.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flatmap-popup-link"
                    >
                      Read full article
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
