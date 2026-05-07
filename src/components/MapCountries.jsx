import { useEffect, useMemo, useRef, useState } from 'react';
import { useMap } from '@/components/ui/map';
import countriesUrl from '../assets/ne_110m_admin_0_countries.geojson?url';
import { getSeverityMeta } from '../utils/mockData';
import { getCoverageMeta } from '../utils/coverageMeta';
import { getReliabilityMeta } from '../utils/credibilityMeta';
import { severityToColor, getIso } from './MapConstants';

/* ──────────────────────────── constants ──────────────────────────── */

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

/* ──────────────────────────── component ──────────────────────────── */

const MapCountries = ({
  regionSeverities,
  mapOverlay,
  coverageStatusByIso = {},
  perCountryReliability = {},
  selectedRegion,
  drillIsos = null,
}) => {
  const { map, isLoaded } = useMap();
  const [countries, setCountries] = useState(null);
  const prevSelectedRef = useRef(null);

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
        matchEntries.push(iso, meta.accent);
      }
      const colorExpr = matchEntries.length > 0
        ? ['match', ['get', '_iso'], ...matchEntries, 'rgba(255,255,255,0.02)']
        : 'rgba(255,255,255,0.02)';

      return {
        'fill-color': colorExpr,
        'fill-opacity': [
          'case',
          ...(drillIsos ? [
            ['!', ['in', ['get', '_iso'], ['literal', [...drillIsos]]]],
            0.015,
          ] : []),
          ['boolean', ['feature-state', 'selected'], false],
          0.42,
          ['boolean', ['feature-state', 'hover'], false],
          0.3,
          0.15,
        ],
      };
    }

    if (mapOverlay === 'coverage') {
      const matchEntries = [];
      for (const [iso, entry] of Object.entries(coverageStatusByIso)) {
        const meta = getCoverageMeta(entry?.status || 'uncovered');
        matchEntries.push(iso, meta.accent);
      }
      const colorExpr = matchEntries.length > 0
        ? ['match', ['get', '_iso'], ...matchEntries, 'rgba(255,255,255,0.02)']
        : 'rgba(255,255,255,0.02)';

      return {
        'fill-color': colorExpr,
        'fill-opacity': [
          'case',
          ...(drillIsos ? [
            ['!', ['in', ['get', '_iso'], ['literal', [...drillIsos]]]],
            0.015,
          ] : []),
          ['boolean', ['feature-state', 'selected'], false],
          0.42,
          ['boolean', ['feature-state', 'hover'], false],
          0.3,
          0.15,
        ],
      };
    }

    const matchEntries = [];
    for (const [iso, entry] of Object.entries(regionSeverities)) {
      matchEntries.push(iso, severityToColor(entry.peakSeverity));
    }
    const colorExpr = matchEntries.length > 0
      ? ['match', ['get', '_iso'], ...matchEntries, 'rgba(0, 200, 255, 0.03)']
      : 'rgba(0, 200, 255, 0.03)';

    return {
      'fill-color': colorExpr,
      'fill-opacity': [
        'case',
        ...(drillIsos ? [
          ['!', ['in', ['get', '_iso'], ['literal', [...drillIsos]]]],
          0.015,
        ] : []),
        ['boolean', ['feature-state', 'selected'], false],
        0.45,
        ['boolean', ['feature-state', 'hover'], false],
        0.35,
        ...(Object.keys(regionSeverities).length > 0 ? [
          ['in', ['get', '_iso'], ['literal', Object.keys(regionSeverities)]],
          0.2,
        ] : []),
        0.03,
      ],
    };
  }, [regionSeverities, mapOverlay, coverageStatusByIso, drillIsos]);

  /* ── country line paint ── */
  const countryLinePaint = useMemo(() => {
    const selectedExpr = selectedRegion
      ? ['==', ['get', '_iso'], selectedRegion]
      : false;

    return {
      'line-color': [
        'case',
        ...(selectedExpr ? [selectedExpr, '#00d4ff'] : []),
        ['boolean', ['feature-state', 'hover'], false],
        'rgba(0, 240, 255, 0.5)',
        'rgba(0, 200, 255, 0.06)',
      ],
      'line-width': [
        'case',
        ...(selectedExpr ? [selectedExpr, 2] : []),
        ['boolean', ['feature-state', 'hover'], false],
        1.5,
        0.5,
      ],
    };
  }, [selectedRegion]);

  /* ── selected glow ── */
  const selectedGlowPaint = useMemo(() => {
    if (!selectedRegion) {
      return { 'line-color': 'transparent', 'line-width': 0 };
    }
    return {
      'line-color': 'rgba(0, 212, 255, 0.25)',
      'line-width': 5,
      'line-blur': 4,
    };
  }, [selectedRegion]);

  const selectedGlowFilter = useMemo(() => {
    return selectedRegion ? ['==', ['get', '_iso'], String(selectedRegion)] : ['==', 1, 0];
  }, [selectedRegion]);

  /* ── countries: source + layers mounted once ── */
  useEffect(() => {
    if (!isLoaded || !map) return undefined;

    if (!map.getSource('countries')) {
      map.addSource('countries', {
        type: 'geojson',
        data: EMPTY_FC,
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
  }, [isLoaded, map]);

  /* ── push data when geojson loads ── */
  useEffect(() => {
    if (!isLoaded || !map || !countries) return;
    const src = map.getSource('countries');
    if (src) {
      try { src.setData(countries); } catch { /* ignore */ }
    }
  }, [isLoaded, map, countries]);

  /* ── update fill paint ── */
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer('country-fill')) return;
    for (const [key, value] of Object.entries(countryFillPaint)) {
      try { map.setPaintProperty('country-fill', key, value); } catch { /* ignore */ }
    }
  }, [isLoaded, map, countryFillPaint]);

  /* ── update border paint ── */
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer('country-border')) return;
    for (const [key, value] of Object.entries(countryLinePaint)) {
      try { map.setPaintProperty('country-border', key, value); } catch { /* ignore */ }
    }
  }, [isLoaded, map, countryLinePaint]);

  /* ── update selected glow filter + paint ── */
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer('country-selected-glow')) return;
    try { map.setFilter('country-selected-glow', selectedGlowFilter); } catch { /* ignore */ }
    for (const [key, value] of Object.entries(selectedGlowPaint)) {
      try { map.setPaintProperty('country-selected-glow', key, value); } catch { /* ignore */ }
    }
  }, [isLoaded, map, selectedGlowFilter, selectedGlowPaint]);

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
  }, [isLoaded, map, selectedRegion, countries]);

  return null;
};

export default MapCountries;
