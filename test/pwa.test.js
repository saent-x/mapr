/**
 * PWA / Offline Support Tests
 *
 * Validates:
 *  • VAL-M5-013: Service worker registration script
 *  • VAL-M5-014: sw.js exists with cache strategies
 *  • VAL-M5-015: eventCache saveSnapshot / loadLastSnapshot integration
 *  • VAL-M5-016: OfflineBanner component exists
 *  • VAL-M5-017: Last-updated timestamp logic
 *  • VAL-M5-018: manifest.json with required fields
 *  • VAL-M5-019: Install prompt event handling
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const PUBLIC = resolve(REPO, 'public');
const SRC = resolve(REPO, 'src');

/* ── helpers ── */
function readText(relPath) {
  return readFileSync(resolve(REPO, relPath), 'utf8');
}

function fileExists(relPath) {
  return existsSync(resolve(REPO, relPath));
}

/* ── VAL-M5-013: Service worker registration ── */
describe('VAL-M5-013: Service worker registration on app load', () => {
  it('main.jsx imports registerServiceWorker', () => {
    const main = readText('src/main.jsx');
    assert.ok(main.includes('registerServiceWorker'), 'main.jsx should import registerServiceWorker');
  });

  it('main.jsx calls registerServiceWorker()', () => {
    const main = readText('src/main.jsx');
    assert.ok(main.includes('registerServiceWorker()'), 'main.jsx should call registerServiceWorker()');
  });

  it('serviceWorkerRegistration.js exists and exports registerServiceWorker', () => {
    const swReg = readText('src/services/serviceWorkerRegistration.js');
    assert.ok(swReg.includes('export function registerServiceWorker'), 'should export registerServiceWorker');
  });

  it('service worker registration calls navigator.serviceWorker.register', () => {
    const swReg = readText('src/services/serviceWorkerRegistration.js');
    assert.ok(swReg.includes('navigator.serviceWorker'), 'should reference navigator.serviceWorker');
    assert.ok(swReg.includes(".register('/sw.js'"), 'should register /sw.js');
    assert.ok(swReg.includes("{ scope: '/' }"), 'should set scope to /');
  });

  it('service worker registration handles updatefound event', () => {
    const swReg = readText('src/services/serviceWorkerRegistration.js');
    assert.ok(swReg.includes("'updatefound'"), 'should listen for updatefound');
  });

  it('service worker registration catches errors gracefully', () => {
    const swReg = readText('src/services/serviceWorkerRegistration.js');
    assert.ok(swReg.includes('.catch(') || swReg.includes('catch (err)'), 'should catch registration errors');
  });
});

/* ── VAL-M5-014: sw.js with caching strategies ── */
describe('VAL-M5-014: Service worker caches core assets', () => {
  it('sw.js exists in public/', () => {
    assert.ok(fileExists('public/sw.js'), 'sw.js should exist in public/');
  });

  it('sw.js defines cache version and cache names', () => {
    const sw = readText('public/sw.js');
    assert.ok(sw.includes('CACHE_VERSION'), 'should define CACHE_VERSION');
    assert.ok(sw.includes('APP_SHELL_CACHE'), 'should define APP_SHELL_CACHE');
    assert.ok(sw.includes('API_CACHE'), 'should define API_CACHE');
  });

  it('sw.js has install event handler that precaches', () => {
    const sw = readText('public/sw.js');
    assert.ok(sw.includes("'install'"), 'should have install event');
    assert.ok(sw.includes('event.waitUntil('), 'should use event.waitUntil');
  });

  it('sw.js has activate event handler that cleans old caches', () => {
    const sw = readText('public/sw.js');
    assert.ok(sw.includes("'activate'"), 'should have activate event');
    assert.ok(sw.includes('self.clients.claim()'), 'should claim clients');
  });

  it('sw.js has fetch event handler', () => {
    const sw = readText('public/sw.js');
    assert.ok(sw.includes("'fetch'"), 'should have fetch event');
  });

  it('sw.js uses cache-first strategy for same-origin assets', () => {
    const sw = readText('public/sw.js');
    assert.ok(sw.includes('cacheFirst'), 'should define cacheFirst strategy');
  });

  it('sw.js uses network-first strategy for API calls', () => {
    const sw = readText('public/sw.js');
    assert.ok(sw.includes('networkFirst'), 'should define networkFirst strategy');
    // API paths should use network-first
    assert.ok(sw.includes('/api/'), 'should handle /api/ paths');
    assert.ok(sw.includes('networkFirst(request, API_CACHE)'), 'API calls should use networkFirst with API_CACHE');
  });

  it('sw.js uses stale-while-revalidate for map tiles', () => {
    const sw = readText('public/sw.js');
    assert.ok(sw.includes('staleWhileRevalidate'), 'should define staleWhileRevalidate strategy');
    assert.ok(sw.includes('basemaps.cartocdn.com'), 'should handle cartocdn tiles');
  });

  it('sw.js returns index.html for offline navigation fallback', () => {
    const sw = readText('public/sw.js');
    assert.ok(sw.includes("/index.html'"), 'should fall back to index.html when offline');
  });
});

/* ── VAL-M5-015: eventCache IndexedDB snapshot caching ── */
describe('VAL-M5-015: Last-known briefing cached in IndexedDB', () => {
  it('eventCache.js exports saveSnapshot', () => {
    const ec = readText('src/services/eventCache.js');
    assert.ok(ec.includes('export async function saveSnapshot'), 'should export saveSnapshot');
  });

  it('eventCache.js exports loadLastSnapshot', () => {
    const ec = readText('src/services/eventCache.js');
    assert.ok(ec.includes('export async function loadLastSnapshot'), 'should export loadLastSnapshot');
  });

  it('saveSnapshot stores timestamp, savedAt, and events', () => {
    const ec = readText('src/services/eventCache.js');
    assert.ok(ec.includes('timestamp: Date.now()'), 'should include timestamp');
    assert.ok(ec.includes("savedAt: new Date().toISOString()"), 'should include savedAt ISO timestamp');
    assert.ok(ec.includes('events: events.map'), 'should include mapped events array');
  });

  it('saveSnapshot maps events to id, lifecycle, severity fields', () => {
    const ec = readText('src/services/eventCache.js');
    assert.ok(ec.includes("id: e.id"), 'snapshot events should include id');
    assert.ok(ec.includes("lifecycle: e.lifecycle"), 'snapshot events should include lifecycle');
    assert.ok(ec.includes("severity: e.severity"), 'snapshot events should include severity');
  });

  it('loadLastSnapshot returns most recent snapshot using cursor order', () => {
    const ec = readText('src/services/eventCache.js');
    assert.ok(ec.includes("openCursor(null, 'prev')"), 'should use reverse cursor for most recent');
  });

  it('newsStore.saveCurrentSnapshot calls eventCache.saveSnapshot', () => {
    const store = readText('src/stores/newsStore.ts');
    assert.ok(store.includes('saveCurrentSnapshot'), 'newsStore should have saveCurrentSnapshot');
    assert.ok(store.includes("saveSnapshot(liveNews)"), 'should call saveSnapshot with liveNews');
  });

  it('newsStore._initSessionMemory calls loadLastSnapshot and saveSnapshot', () => {
    const store = readText('src/stores/newsStore.ts');
    assert.ok(store.includes('_initSessionMemory'), 'should have _initSessionMemory');
    assert.ok(store.includes('loadLastSnapshot()'), 'should call loadLastSnapshot');
    assert.ok(store.includes('saveSnapshot(articles)'), 'should call saveSnapshot with articles');
  });
});

/* ── VAL-M5-016: Offline indicator banner ── */
describe('VAL-M5-016: Offline indicator banner', () => {
  it('OfflineBanner.jsx exists', () => {
    assert.ok(fileExists('src/components/OfflineBanner.jsx'), 'OfflineBanner component should exist');
  });

  it('OfflineBanner imports useTranslation for i18n', () => {
    const comp = readText('src/components/OfflineBanner.jsx');
    assert.ok(comp.includes('useTranslation'), 'should use react-i18next useTranslation');
  });

  it('OfflineBanner imports WifiOff icon from lucide-react', () => {
    const comp = readText('src/components/OfflineBanner.jsx');
    assert.ok(comp.includes('WifiOff'), 'should import WifiOff from lucide-react');
  });

  it('OfflineBanner uses useOnlineStatus hook', () => {
    const comp = readText('src/components/OfflineBanner.jsx');
    assert.ok(comp.includes('useOnlineStatus'), 'should use useOnlineStatus hook');
  });

  it('OfflineBanner has role="alert" for accessibility', () => {
    const comp = readText('src/components/OfflineBanner.jsx');
    assert.ok(comp.includes('role="alert"'), 'should have alert role');
  });

  it('OfflineBanner shows t(\'offline.title\') text', () => {
    const comp = readText('src/components/OfflineBanner.jsx');
    assert.ok(comp.includes("t('offline.title'"), 'should use offline.title i18n key');
  });

  it('OfflineBanner is imported and rendered in Layout.jsx', () => {
    const layout = readText('src/components/Layout.jsx');
    assert.ok(layout.includes('import OfflineBanner'), 'Layout should import OfflineBanner');
    assert.ok(layout.includes('<OfflineBanner />'), 'Layout should render OfflineBanner');
  });

  it('useOnlineStatus hook exists', () => {
    assert.ok(fileExists('src/hooks/useOnlineStatus.js'), 'useOnlineStatus hook should exist');
  });

  it('useOnlineStatus listens for online/offline events', () => {
    const hook = readText('src/hooks/useOnlineStatus.js');
    assert.ok(hook.includes("'online'"), 'should listen for online event');
    assert.ok(hook.includes("'offline'"), 'should listen for offline event');
    assert.ok(hook.includes('navigator.onLine'), 'should check navigator.onLine');
  });

  it('useOnlineStatus loads last snapshot from eventCache when offline', () => {
    const hook = readText('src/hooks/useOnlineStatus.js');
    assert.ok(hook.includes('loadLastSnapshot'), 'should import loadLastSnapshot');
    assert.ok(hook.includes('loadLastSnapshot()'), 'should call loadLastSnapshot');
  });
});

/* ── VAL-M5-017: Last updated timestamp for cached data ── */
describe('VAL-M5-017: Last updated timestamp shown', () => {
  it('useOnlineStatus formats relative time from savedAt ISO', () => {
    const hook = readText('src/hooks/useOnlineStatus.js');
    assert.ok(hook.includes('savedAt'), 'should use savedAt from snapshot');
    assert.ok(hook.includes('formatRelativeTime'), 'should format relative time');
  });

  it('OfflineBanner shows lastUpdatedAge when available', () => {
    const comp = readText('src/components/OfflineBanner.jsx');
    assert.ok(comp.includes('lastUpdatedAge'), 'should reference lastUpdatedAge');
    assert.ok(comp.includes("t('offline.lastUpdated'"), 'should use offline.lastUpdated i18n key');
  });

  it('formatRelativeTime handles "just now" (< 1 min)', () => {
    const hook = readText('src/hooks/useOnlineStatus.js');
    assert.ok(hook.includes("'just now'"), 'should show "just now" for recent timestamps');
  });

  it('formatRelativeTime handles minutes, hours, days', () => {
    const hook = readText('src/hooks/useOnlineStatus.js');
    assert.ok(hook.includes("minute"), 'should handle minutes');
    assert.ok(hook.includes("hour"), 'should handle hours');
    assert.ok(hook.includes("day"), 'should handle days');
  });
});

/* ── VAL-M5-018: PWA manifest with required fields ── */
describe('VAL-M5-018: PWA manifest exists and is linked', () => {
  it('manifest.json exists in public/', () => {
    assert.ok(fileExists('public/manifest.json'), 'manifest.json should exist');
  });

  it('manifest.json has required fields', () => {
    const manifest = JSON.parse(readText('public/manifest.json'));
    assert.ok(typeof manifest.name === 'string' && manifest.name.length > 0, 'name required');
    assert.ok(typeof manifest.short_name === 'string' && manifest.short_name.length > 0, 'short_name required');
    assert.ok(typeof manifest.start_url === 'string', 'start_url required');
    assert.equal(manifest.display, 'standalone', 'display must be standalone');
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'icons array with ≥2 entries required');
  });

  it('manifest icons include 192x192 and 512x512', () => {
    const manifest = JSON.parse(readText('public/manifest.json'));
    const sizes = manifest.icons.map((i) => i.sizes);
    assert.ok(sizes.includes('192x192'), 'should have 192x192 icon');
    assert.ok(sizes.includes('512x512'), 'should have 512x512 icon');
  });

  it('manifest is linked in index.html', () => {
    const html = readText('index.html');
    assert.ok(html.includes('<link rel="manifest" href="/manifest.json"'), 'manifest link required');
  });

  it('index.html has theme-color meta tag', () => {
    const html = readText('index.html');
    assert.ok(html.includes('<meta name="theme-color"'), 'theme-color meta required');
  });

  it('index.html has apple-mobile-web-app meta tags', () => {
    const html = readText('index.html');
    assert.ok(html.includes('apple-mobile-web-app-capable'), 'apple-mobile-web-app-capable required');
    assert.ok(html.includes('apple-mobile-web-app-title'), 'apple-mobile-web-app-title required');
  });

  it('icon-192.svg and icon-512.svg exist', () => {
    assert.ok(fileExists('public/icon-192.svg'), 'icon-192.svg should exist');
    assert.ok(fileExists('public/icon-512.svg'), 'icon-512.svg should exist');
  });
});

/* ── VAL-M5-019: App installable ── */
describe('VAL-M5-019: App is installable on supported browsers', () => {
  it('serviceWorkerRegistration listens for beforeinstallprompt event', () => {
    const swReg = readText('src/services/serviceWorkerRegistration.js');
    assert.ok(swReg.includes("'beforeinstallprompt'"), 'should listen for beforeinstallprompt');
  });

  it('serviceWorkerRegistration listens for appinstalled event', () => {
    const swReg = readText('src/services/serviceWorkerRegistration.js');
    assert.ok(swReg.includes("'appinstalled'"), 'should listen for appinstalled');
  });

  it('serviceWorkerRegistration exports triggerInstall function', () => {
    const swReg = readText('src/services/serviceWorkerRegistration.js');
    assert.ok(swReg.includes('export async function triggerInstall'), 'should export triggerInstall');
  });

  it('serviceWorkerRegistration exports canInstall function', () => {
    const swReg = readText('src/services/serviceWorkerRegistration.js');
    assert.ok(swReg.includes('export function canInstall'), 'should export canInstall');
  });
});

/* ── i18n coverage ── */
describe('PWA offline i18n coverage', () => {
  const locales = ['en', 'es', 'fr', 'ar', 'zh'];
  for (const lang of locales) {
    it(`${lang}.json has offline.title and offline.lastUpdated`, () => {
      const data = JSON.parse(readText(`src/i18n/locales/${lang}.json`));
      assert.ok(typeof data?.offline?.title === 'string' && data.offline.title.length > 0,
        `${lang}: offline.title must be non-empty string`);
      assert.ok(typeof data?.offline?.lastUpdated === 'string' && data.offline.lastUpdated.length > 0,
        `${lang}: offline.lastUpdated must be non-empty string`);
    });
  }
});

/* ── CSS offline banner styles ── */
describe('Offline banner CSS', () => {
  it('index.css has .offline-banner styles', () => {
    const css = readText('src/index.css');
    assert.ok(css.includes('.offline-banner'), 'should have .offline-banner class');
  });

  it('index.css has offlineBannerSlide animation', () => {
    const css = readText('src/index.css');
    assert.ok(css.includes('offlineBannerSlide'), 'should have slide-in animation');
  });

  it('offline banner uses MAPR color variables', () => {
    const css = readText('src/index.css');
    assert.ok(css.includes('var(--sev-red)') || css.includes('var(--ff-mono)'), 'should use CSS custom properties');
  });
});
