import { forwardRef, type ReactNode } from 'react';
import {
  Map,
  type MapRef,
  type MapViewport,
} from '@/components/ui/map';

// Default tile/style URLs: CARTO basemap-gl tiles (same source as legacy FlatMap
// and mapcn's built-in defaults). Free, no API key, light/dark variants match
// existing app theming.
const DEFAULT_STYLE_DARK =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const DEFAULT_STYLE_LIGHT =
  'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

export type AppMapSurface = 'flat' | 'globe';

export type AppMapProps = {
  surface: AppMapSurface;
  viewport?: Partial<MapViewport>;
  onViewportChange?: (viewport: MapViewport) => void;
  styleUrl?: string;
  theme?: 'light' | 'dark';
  className?: string;
  children?: ReactNode;
};

const AppMap = forwardRef<MapRef, AppMapProps>(function AppMap(
  { surface, viewport, onViewportChange, styleUrl, theme, className, children },
  ref,
) {
  const styles = styleUrl
    ? { light: styleUrl, dark: styleUrl }
    : { light: DEFAULT_STYLE_LIGHT, dark: DEFAULT_STYLE_DARK };

  const projection = surface === 'globe' ? { type: 'globe' as const } : undefined;

  return (
    <Map
      ref={ref}
      className={className}
      theme={theme}
      styles={styles}
      projection={projection}
      viewport={viewport}
      onViewportChange={onViewportChange}
    >
      {children}
    </Map>
  );
});

export default AppMap;
export type { MapRef, MapViewport };
