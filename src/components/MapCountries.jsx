import { useEffect, useMemo, useRef, useState } from 'react';
import { useMap } from '@/components/ui/map';
import countriesUrl from '../assets/ne_110m_admin_0_countries.geojson?url';
import { getSeverityMeta } from '../utils/mockData';
import { getCoverageMeta } from '../utils/coverageMeta';
import { getReliabilityMeta } from '../utils/credibilityMeta';
import { severityToColor, getIso } from './MapConstants';

/* ──────────────────────────── constants ──────────────────────────── */

const EMPTY_FC = { type: 'FeatureCollection', features: [] };
const DARK_COUNTRY_PALETTE = {
  emptyFill: 'rgba(45, 138, 148, 0.16)',
  selectedLine: '#44c1cc',
  hoverLine: 'rgba(80, 205, 216, 0.78)',
  quietLine: 'rgba(80, 174, 186, 0.34)',
  selectedGlow: 'rgba(80, 205, 216, 0.34)',
  overlayFallback: 'rgba(80, 174, 186, 0.14)',
  selectedOpacity: 0.58,
  hoverOpacity: 0.46,
  dataOpacity: 0.42,
  emptyOpacity: 0.16,
};
const LIGHT_COUNTRY_PALETTE = {
  emptyFill: 'rgba(32, 84, 76, 0.24)',
  selectedLine: '#0e5962',
  hoverLine: 'rgba(14, 89, 98, 0.92)',
  quietLine: 'rgba(24, 58, 55, 0.58)',
  selectedGlow: 'rgba(14, 89, 98, 0.28)',
  overlayFallback: 'rgba(28, 76, 72, 0.16)',
  selectedOpacity: 0.52,
  hoverOpacity: 0.42,
  dataOpacity: 0.34,
  emptyOpacity: 0.2,
};

/* ──────────────────────────── component ──────────────────────────── */

const MapCountries = ({
  regionSeverities,
  mapOverlay,
  coverageStatusByIso = {},
  perCountryReliability = {},
  selectedRegion,
  drillIsos = null,
  isLight = false,
}) => {
  const { map, isLoaded, styleRevision } = useMap();
  const [countries, setCountries] = useState(null);
  const prevSelectedRef = useRef(null);
  const countryPalette = useMemo(
    () => (isLight ? LIGHT_COUNTRY_PALETTE : DARK_COUNTRY_PALETTE),
    [isLight],
  );

  /* ── fetch countries GeoJSON ── */
  useEffect(() => {
    let mounted = true;
    fetch(countriesUrl)
      .then((r) => r.json())
      .then((geojson) => {
        if (!mounted) return;
        const processed = {
          ...geojson,
          features: geojson.features.map((f) => ({
            ...f,
            properties: {
              ...f.properties,
              _iso: getIso(f) || '',
              _name: f.properties.NAME || f.properties.ADMIN || '',
            },
          })),
        };
        setCountries(processed);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  /* ── country fill paint ── */
  const countryFillPaint = useMemo(() => {
    if (mapOverlay === 'reliability') {
      const matchEntries = [];
      for (const [iso, entry] of Object.entries(perCountryReliability)) {
        const meta = getReliabilityMeta(entry.tier || 'unknown');
        matchEntries.push(iso, meta.mapAccent || meta.accent);
      }
      const colorExpr = matchEntries.length > 0
        ? ['match', ['get', '_iso'], ...matchEntries, countryPalette.overlayFallback]
        : countryPalette.overlayFallback;

      return {
        'fill-color': colorExpr,
        'fill-opacity': [
          'case',
          ...(drillIsos ? [
            ['!', ['in', ['get', '_iso'], ['literal', [...drillIsos]]]],
            0.015,
          ] : []),
          ['boolean', ['feature-state', 'selected'], false],
          countryPalette.selectedOpacity,
          ['boolean', ['feature-state', 'hover'], false],
          countryPalette.hoverOpacity,
          isLight ? 0.2 : 0.15,
        ],
      };
    }

    if (mapOverlay === 'coverage') {
      const matchEntries = [];
      for (const [iso, entry] of Object.entries(coverageStatusByIso)) {
        const meta = getCoverageMeta(entry?.status || 'uncovered');
        matchEntries.push(iso, meta.mapAccent || meta.accent);
      }
      const colorExpr = matchEntries.length > 0
        ? ['match', ['get', '_iso'], ...matchEntries, countryPalette.overlayFallback]
        : countryPalette.overlayFallback;

      return {
        'fill-color': colorExpr,
        'fill-opacity': [
          'case',
          ...(drillIsos ? [
            ['!', ['in', ['get', '_iso'], ['literal', [...drillIsos]]]],
            0.015,
          ] : []),
          ['boolean', ['feature-state', 'selected'], false],
          countryPalette.selectedOpacity,
          ['boolean', ['feature-state', 'hover'], false],
          countryPalette.hoverOpacity,
          isLight ? 0.2 : 0.15,
        ],
      };
    }

    const matchEntries = [];
    for (const [iso, entry] of Object.entries(regionSeverities)) {
      matchEntries.push(iso, severityToColor(entry.peakSeverity));
    }
    const colorExpr = matchEntries.length > 0
      ? ['match', ['get', '_iso'], ...matchEntries, countryPalette.emptyFill]
      : countryPalette.emptyFill;

    return {
      'fill-color': colorExpr,
      'fill-opacity': [
        'case',
        ...(drillIsos ? [
          ['!', ['in', ['get', '_iso'], ['literal', [...drillIsos]]]],
          0.015,
        ] : []),
        ['boolean', ['feature-state', 'selected'], false],
        countryPalette.selectedOpacity,
        ['boolean', ['feature-state', 'hover'], false],
        countryPalette.hoverOpacity,
        ...(Object.keys(regionSeverities).length > 0 ? [
          ['in', ['get', '_iso'], ['literal', Object.keys(regionSeverities)]],
          countryPalette.dataOpacity,
        ] : []),
        countryPalette.emptyOpacity,
      ],
    };
  }, [regionSeverities, mapOverlay, coverageStatusByIso, perCountryReliability, drillIsos, countryPalette, isLight]);

  /* ── country line paint ── */
  const countryLinePaint = useMemo(() => {
    const selectedExpr = selectedRegion
      ? ['==', ['get', '_iso'], selectedRegion]
      : false;

    return {
      'line-color': [
        'case',
        ...(selectedExpr ? [selectedExpr, countryPalette.selectedLine] : []),
        ['boolean', ['feature-state', 'hover'], false],
        countryPalette.hoverLine,
        countryPalette.quietLine,
      ],
      'line-width': [
        'case',
        ...(selectedExpr ? [selectedExpr, 2] : []),
        ['boolean', ['feature-state', 'hover'], false],
        1.5,
        0.5,
      ],
    };
  }, [selectedRegion, countryPalette]);

  /* ── selected glow ── */
  const selectedGlowPaint = useMemo(() => {
    if (!selectedRegion) {
      return { 'line-color': 'transparent', 'line-width': 0 };
    }
    return {
      'line-color': countryPalette.selectedGlow,
      'line-width': 5,
      'line-blur': 4,
    };
  }, [selectedRegion, countryPalette]);

  const selectedGlowFilter = useMemo(() => {
    return selectedRegion ? ['==', ['get', '_iso'], String(selectedRegion)] : ['==', 1, 0];
  }, [selectedRegion]);

  /* ── countries: source + layers mounted once ── */
  useEffect(() => {
    if (!isLoaded || !map) return undefined;

    if (!map.getSource('countries')) {
      map.addSource('countries', {
        type: 'geojson',
        data: countries || EMPTY_FC,
        promoteId: '_iso',
      });
    }

    if (!map.getLayer('country-fill')) {
      map.addLayer({ id: 'country-fill', type: 'fill', source: 'countries', paint: countryFillPaint });
    }
    if (!map.getLayer('country-border')) {
      map.addLayer({ id: 'country-border', type: 'line', source: 'countries', paint: countryLinePaint });
    }
    if (!map.getLayer('country-selected-glow')) {
      map.addLayer({
        id: 'country-selected-glow',
        type: 'line',
        source: 'countries',
        filter: selectedGlowFilter,
        paint: selectedGlowPaint,
      });
    }

    return () => {
      try {
        if (map.getLayer('country-selected-glow')) map.removeLayer('country-selected-glow');
        if (map.getLayer('country-border')) map.removeLayer('country-border');
        if (map.getLayer('country-fill')) map.removeLayer('country-fill');
        if (map.getSource('countries')) map.removeSource('countries');
      } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map, styleRevision]);

  /* ── push data when geojson loads ── */
  useEffect(() => {
    if (!isLoaded || !map || !countries) return;
    const src = map.getSource('countries');
    if (src) {
      try { src.setData(countries); } catch { /* ignore */ }
    }
  }, [isLoaded, map, countries, styleRevision]);

  /* ── update fill paint ── */
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer('country-fill')) return;
    for (const [key, value] of Object.entries(countryFillPaint)) {
      try { map.setPaintProperty('country-fill', key, value); } catch { /* ignore */ }
    }
  }, [isLoaded, map, countryFillPaint, styleRevision]);

  /* ── update border paint ── */
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer('country-border')) return;
    for (const [key, value] of Object.entries(countryLinePaint)) {
      try { map.setPaintProperty('country-border', key, value); } catch { /* ignore */ }
    }
  }, [isLoaded, map, countryLinePaint, styleRevision]);

  /* ── update selected glow filter + paint ── */
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer('country-selected-glow')) return;
    try { map.setFilter('country-selected-glow', selectedGlowFilter); } catch { /* ignore */ }
    for (const [key, value] of Object.entries(selectedGlowPaint)) {
      try { map.setPaintProperty('country-selected-glow', key, value); } catch { /* ignore */ }
    }
  }, [isLoaded, map, selectedGlowFilter, selectedGlowPaint, styleRevision]);

  /* ── feature-state selected ── */
  useEffect(() => {
    if (!isLoaded || !map || !map.getSource('countries')) return;
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
  }, [isLoaded, map, selectedRegion, countries, styleRevision]);

  return null;
};

export default MapCountries;
