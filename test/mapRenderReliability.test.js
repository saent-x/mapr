import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

describe('MapLibre render reliability', () => {
  const map = readFileSync(join(ROOT, 'src/components/ui/map.tsx'), 'utf8');

  it('resizes the shared map after layout settles and when the document becomes visible', () => {
    assert.match(map, /function Map\(/);
    assert.match(map, /const scheduleMapResize = useCallback/);
    assert.match(map, /new ResizeObserver\(queueResize\)/);
    assert.match(map, /requestAnimationFrame/);
    assert.match(map, /setTimeout\(resizeWhenVisible,\s*80\)/);
    assert.match(map, /setTimeout\(resizeWhenVisible,\s*240\)/);
    assert.match(map, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
    assert.match(map, /window\.addEventListener\("resize", queueResize\)/);
    assert.match(map, /map\.on\("load", queueResize\)/);
    assert.match(map, /map\.on\("styledata", queueResize\)/);
  });

  it('only calls map.resize when the map container has usable dimensions', () => {
    assert.match(map, /const rect = container\.getBoundingClientRect\(\)/);
    assert.match(map, /rect\.width > 0 && rect\.height > 0[\s\S]*?map\.resize\(\)/);
  });

  it('does not switch to offline style on the first recoverable pre-load map error', () => {
    assert.match(map, /firstLoadErrorRef/);
    assert.match(map, /const startLoadWatchdog = \(\) =>/);
    assert.match(map, /setTimeout\(\(\) => \{[\s\S]*?if \(loadedRef\.current\) return/);
    assert.match(map, /map\.on\("error", errorHandler\)/);
    assert.match(map, /firstLoadErrorRef\.current =[\s\S]*?err\?\.message/);
    assert.doesNotMatch(
      map,
      /const errorHandler[\s\S]*?map\.setStyle\(fallbackStyle,\s*\{\s*diff:\s*false\s*\}\)/,
      'errorHandler should record early errors; only the load watchdog should fallback',
    );
  });

  it('waits for the initial map load before applying theme/style swaps', () => {
    assert.match(map, /if \(!mapInstance \|\| !resolvedTheme \|\| !isLoaded\) return/);
    assert.match(map, /mapInstance\.setStyle\(newStyle,\s*\{\s*diff:\s*mapInstance\.isStyleLoaded\(\)\s*\}\)/);
  });

  it('publishes a style revision so overlay layers rehydrate after style rebuilds', () => {
    const countries = readFileSync(join(ROOT, 'src/components/MapCountries.jsx'), 'utf8');
    const articles = readFileSync(join(ROOT, 'src/components/MapArticles.jsx'), 'utf8');
    const arcs = readFileSync(join(ROOT, 'src/components/MapArcs.jsx'), 'utf8');
    const velocity = readFileSync(join(ROOT, 'src/components/MapVelocity.jsx'), 'utf8');
    const tracking = readFileSync(join(ROOT, 'src/components/MapTracking.jsx'), 'utf8');

    assert.match(map, /styleRevision:\s*number/);
    assert.match(map, /const \[styleRevision,\s*setStyleRevision\]/);
    assert.match(map, /setStyleRevision\(\(revision\) => revision \+ 1\)/);
    assert.match(map, /styleRevision,/);

    for (const source of [countries, articles, arcs, velocity, tracking]) {
      assert.match(source, /styleRevision/, 'Map overlay component must subscribe to style revisions');
    }
  });
});
