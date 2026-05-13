/**
 * Service Worker Registration
 *
 * Registers the PWA service worker on app load. Handles the install
 * prompt event for PWA installation on supported browsers.
 */

/** @type {BeforeInstallPromptEvent|null} */
let deferredPrompt = null;

function unregisterDevelopmentServiceWorkers() {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    })
    .catch((err) => {
      console.warn('[SW] Development cleanup failed:', err.message);
    });

  if ('caches' in window) {
    caches
      .keys()
      .then((keys) => {
        keys
          .filter((key) => key.startsWith('mapr-'))
          .forEach((key) => caches.delete(key));
      })
      .catch((err) => {
        console.warn('[SW] Development cache cleanup failed:', err.message);
      });
  }
}

/**
 * Register the service worker and set up PWA install prompt handling.
 * Safe to call in non-browser environments (no-ops gracefully).
 */
export function registerServiceWorker() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  if (import.meta.env.DEV) {
    unregisterDevelopmentServiceWorkers();
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        // Surface SW updates as a `mapr:sw-update` window event so the UI
        // (e.g. a toast in App or Layout) can offer the user a "reload"
        // action instead of silently shipping a stale shell.
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent('mapr:sw-update', {
                detail: { activate: () => newWorker.postMessage({ type: 'SKIP_WAITING' }) },
              }));
            }
          });
        });
      })
      .catch((err) => {
        console.warn('[SW] Registration failed:', err.message);
      });
  });

  // When the new SW takes control, reload once so the user sees the
  // updated app shell.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  // Listen for the beforeinstallprompt event (Chrome / Edge install prompt)
  window.addEventListener('beforeinstallprompt', (event) => {
    // Prevent the default mini-infobar from appearing
    event.preventDefault();
    // Save the event so it can be triggered later
    deferredPrompt = event;
  });

  // Track successful installation
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    console.log('[PWA] App installed successfully');
  });
}

/**
 * Check if the app can be installed (i.e., the beforeinstallprompt event has fired).
 * @returns {boolean}
 */
export function canInstall() {
  return deferredPrompt !== null;
}

/**
 * Trigger the PWA install prompt. Should be called from a user gesture
 * (e.g., button click). Returns a promise that resolves with the outcome.
 *
 * @returns {Promise<{outcome: 'accepted'|'dismissed', platform: string}>}
 */
export async function triggerInstall() {
  if (!deferredPrompt) {
    throw new Error('Install prompt not available');
  }

  try {
    const platform = deferredPrompt.platform || 'web';
    const { outcome } = await deferredPrompt.prompt();
    deferredPrompt = null;
    return { outcome, platform };
  } catch (err) {
    deferredPrompt = null;
    throw err;
  }
}
