import { useEffect, useMemo } from 'react';
import { useMap } from '@/components/ui/map';
import { severityToColor } from './MapConstants';
import { getStatesByIso } from '../utils/statesData';

/* ──────────────────────────── constants ──────────────────────────── */

const EMPTY_FC = { type: 'FeatureCollection', features: [] };
const CLUSTER_FILL = 'rgba(45, 138, 148, 0.12)';
const CLUSTER_STROKE = 'rgba(45, 138, 148, 0.25)';
const CLUSTER_TEXT = 'rgba(45, 138, 148, 0.82)';

/* ──────────────────────────── component ──────────────────────────── */

const MapArticles = ({
  newsList,
  selectedStory,
  surface = 'flat',
  selectedRegion,
}) => {
  const { map, isLoaded, styleRevision } = useMap();

  /* ── articles GeoJSON ── */
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

  /* ── selected story GeoJSON ── */
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

  /* ── locality labels GeoJSON (flat only) ── */
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
          'circle-color': CLUSTER_FILL,
          'circle-radius': [
            'step', ['get', 'point_count'],
            8, 10, 10, 50, 12,
          ],
          'circle-stroke-width': 0.5,
          'circle-stroke-color': CLUSTER_STROKE,
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
          'text-color': CLUSTER_TEXT,
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
  }, [isLoaded, map, styleRevision]);

  useEffect(() => {
    if (!isLoaded || !map) return;
    const src = map.getSource('articles');
    if (src) src.setData(articlesGeoJson);
  }, [isLoaded, map, articlesGeoJson, styleRevision]);

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
  }, [isLoaded, map, styleRevision]);

  useEffect(() => {
    if (!isLoaded || !map) return;
    const src = map.getSource('selected-story');
    if (src) src.setData(selectedStoryGeoJson);
  }, [isLoaded, map, selectedStoryGeoJson, styleRevision]);

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
  }, [isLoaded, map, surface, styleRevision]);

  useEffect(() => {
    if (!isLoaded || !map || surface !== 'flat') return;
    const src = map.getSource('locality-labels');
    if (src) src.setData(localityLabelsGeoJson);
  }, [isLoaded, map, localityLabelsGeoJson, surface, styleRevision]);

  return null;
};

export default MapArticles;
