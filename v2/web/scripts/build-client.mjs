// Builds the desk page into dist/public: bundles src/client/main.ts, bakes the world
// outline (world-atlas land-110m, Natural Earth, public domain) into an equirectangular
// SVG path at build time, and copies the page, styles and Geist fonts. No runtime CDN.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist/public');
const require = createRequire(import.meta.url);

/** lon/lat -> x in [0,360], y in [0,180] (equirectangular). One decimal is ~11 km: plenty at 110m. */
function landPath() {
  const topo = JSON.parse(readFileSync(require.resolve('world-atlas/land-110m.json'), 'utf8'));
  const land = feature(topo, topo.objects.land);
  const f = (n) => (Math.round(n * 10) / 10).toString();
  let d = '';
  for (const feat of land.features) {
    const g = feat.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        let prev = '';
        ring.forEach(([lon, lat], i) => {
          const pt = `${f(lon + 180)} ${f(90 - lat)}`;
          if (pt === prev) return;
          d += (i === 0 ? 'M' : 'L') + pt;
          prev = pt;
        });
        d += 'Z';
      }
    }
  }
  return d;
}

const world = {
  name: 'world',
  setup(b) {
    b.onResolve({ filter: /^virtual:world$/ }, () => ({ path: 'world', namespace: 'world' }));
    b.onLoad({ filter: /.*/, namespace: 'world' }, () => ({ contents: `export default ${JSON.stringify(landPath())};`, loader: 'js' }));
  },
};

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fonts'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/client/main.ts')],
  outfile: join(out, 'app.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  plugins: [world],
  logLevel: 'warning',
});

copyFileSync(join(root, 'src/client/index.html'), join(out, 'index.html'));
copyFileSync(join(root, 'src/client/desk.css'), join(out, 'desk.css'));
for (const [pkg, file] of [
  ['@fontsource/geist-sans', 'geist-sans-latin-400-normal.woff2'],
  ['@fontsource/geist-sans', 'geist-sans-latin-500-normal.woff2'],
  ['@fontsource/geist-sans', 'geist-sans-latin-600-normal.woff2'],
  ['@fontsource/geist-mono', 'geist-mono-latin-400-normal.woff2'],
  ['@fontsource/geist-mono', 'geist-mono-latin-500-normal.woff2'],
]) {
  copyFileSync(join(dirname(require.resolve(`${pkg}/package.json`)), 'files', file), join(out, 'fonts', file));
}
