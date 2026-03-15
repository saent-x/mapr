import React, { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import { getSeverityMeta } from '../utils/mockData';

// Dark tile layer from CartoDB
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

// Custom cluster icon creator
const createClusterIcon = (cluster) => {
  const markers = cluster.getAllChildMarkers();
  const count = markers.length;
  let worstSeverity = 0;

  markers.forEach((m) => {
    const sev = m.options?.data?.severity || 0;
    if (sev > worstSeverity) worstSeverity = sev;
  });

  const meta = getSeverityMeta(worstSeverity);
  const size = count < 10 ? 36 : count < 50 ? 44 : 52;

  return L.divIcon({
    html: `<div class="cluster-icon" style="
      width: ${size}px;
      height: ${size}px;
      background: ${meta.muted};
      border: 2px solid ${meta.accent};
      color: ${meta.accent};
    ">${count}</div>`,
    className: 'cluster-icon-wrapper',
    iconSize: [size, size]
  });
};

// Component to sync map view with selected story
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

        <MarkerClusterGroup
          chunkedLoading
          maxClusterRadius={50}
          spiderfyOnMaxZoom
          showCoverageOnHover={false}
          iconCreateFunction={createClusterIcon}
        >
          {markers.map((story) => (
            <CircleMarker
              key={story.id}
              center={[story.coordinates[0], story.coordinates[1]]}
              radius={selectedStory?.id === story.id ? 10 : 6 + story.severity / 25}
              pathOptions={{
                fillColor: selectedStory?.id === story.id ? '#ffffff' : story.meta.accent,
                fillOpacity: 0.85,
                color: selectedStory?.id === story.id ? '#ffffff' : story.meta.accent,
                weight: selectedStory?.id === story.id ? 3 : 1.5,
                opacity: 0.9
              }}
              data={story}
              eventHandlers={{
                click: () => onStorySelect(story)
              }}
            >
              <Tooltip
                direction="top"
                offset={[0, -8]}
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
          ))}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  );
};

export default FlatMap;
