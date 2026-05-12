import { useEffect, useMemo, useState } from 'react';
import countriesUrl from '../assets/ne_110m_admin_0_countries.geojson?url';
import { severityToColor, getIso } from './MapConstants';

const WIDTH = 1000;
const HEIGHT = 500;

function project([lng, lat]) {
  return [
    ((lng + 180) / 360) * WIDTH,
    ((90 - lat) / 180) * HEIGHT,
  ];
}

function ringToPath(ring) {
  if (!Array.isArray(ring) || ring.length === 0) return '';
  return ring.map((coord, index) => {
    const [x, y] = project(coord);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ') + ' Z';
}

function geometryToPath(geometry) {
  if (!geometry) return '';
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map(ringToPath).join(' ');
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .flatMap((polygon) => polygon.map(ringToPath))
      .join(' ');
  }
  return '';
}

export default function MapStaticBackdrop({
  regionSeverities = {},
  selectedRegion = null,
  isLight = false,
}) {
  const [features, setFeatures] = useState([]);

  useEffect(() => {
    let mounted = true;
    fetch(countriesUrl)
      .then((res) => res.json())
      .then((geojson) => {
        if (!mounted) return;
        setFeatures(Array.isArray(geojson.features) ? geojson.features : []);
      })
      .catch(() => {
        if (mounted) setFeatures([]);
      });
    return () => { mounted = false; };
  }, []);

  const paths = useMemo(() => features.map((feature) => {
    const iso = getIso(feature);
    const severity = regionSeverities?.[iso]?.peakSeverity;
    return {
      iso,
      path: geometryToPath(feature.geometry),
      fill: severity != null
        ? severityToColor(severity)
        : isLight ? '#6f8580' : '#31575a',
      selected: iso && iso === selectedRegion,
      hasData: severity != null,
    };
  }).filter((item) => item.path), [features, regionSeverities, selectedRegion, isLight]);

  return (
    <svg
      className="map-static-backdrop"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <rect width={WIDTH} height={HEIGHT} className="map-static-backdrop-water" />
      {paths.map((item) => (
        <path
          key={item.iso || item.path.slice(0, 20)}
          d={item.path}
          className={item.selected ? 'is-selected' : item.hasData ? 'has-data' : undefined}
          fill={item.fill}
        />
      ))}
    </svg>
  );
}
