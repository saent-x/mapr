// Builds the desk page into dist/public: bundles src/client/main.ts with MapLibre GL
// (JS -> app.js, its CSS -> app.css) and copies the page, styles, headers and Geist fonts.
// Nothing loads from a CDN; only map tiles and glyphs come from tiles.openfreemap.org.
// A low-detail basemap (Natural Earth 1:110m countries and borders, public domain) is baked
// in as GeoJSON so the map is never blank when tiles fail.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mesh } from 'topojson-client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist/public');
const require = createRequire(import.meta.url);

/** Internal country borders at 1:110m, coordinates rounded to 0.01° (~1 km). Country fills come from src/client/countries.json. */
function basemap() {
  const load = (f) => JSON.parse(readFileSync(require.resolve(`world-atlas/${f}`), 'utf8'));
  const countries = load('countries-110m.json');
  const round = (g) => JSON.parse(JSON.stringify(g, (_, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));
  return {
    borders: round({ type: 'Feature', properties: {}, geometry: mesh(countries, countries.objects.countries, (a, b) => a !== b) }),
  };
}

const virtualBasemap = {
  name: 'basemap',
  setup(b) {
    b.onResolve({ filter: /^virtual:basemap$/ }, () => ({ path: 'basemap', namespace: 'basemap' }));
    b.onLoad({ filter: /.*/, namespace: 'basemap' }, () => ({ contents: JSON.stringify(basemap()), loader: 'json' }));
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
  legalComments: 'eof',
  plugins: [virtualBasemap],
  logLevel: 'warning',
});

copyFileSync(join(root, 'src/client/index.html'), join(out, 'index.html'));
copyFileSync(join(root, 'src/client/desk.css'), join(out, 'desk.css'));
copyFileSync(join(root, 'src/client/_headers'), join(out, '_headers'));
for (const [pkg, file] of [
  ['@fontsource/geist-sans', 'geist-sans-latin-400-normal.woff2'],
  ['@fontsource/geist-sans', 'geist-sans-latin-500-normal.woff2'],
  ['@fontsource/geist-sans', 'geist-sans-latin-600-normal.woff2'],
  ['@fontsource/geist-mono', 'geist-mono-latin-400-normal.woff2'],
  ['@fontsource/geist-mono', 'geist-mono-latin-500-normal.woff2'],
]) {
  copyFileSync(join(dirname(require.resolve(`${pkg}/package.json`)), 'files', file), join(out, 'fonts', file));
}

for (const f of ['app.js', 'app.css']) console.log(`${f} ${(statSync(join(out, f)).size / 1024).toFixed(0)} KiB`);
