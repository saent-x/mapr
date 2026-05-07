/**
 * Service Worker Registration
 *
 * Registers the PWA service worker on app load. Handles the install
 * prompt event for PWA installation on supported browsers.
 */

/** @type {BeforeInstallPromptEvent|null} */
let deferredPrompt = null;

/**
 * Register the service worker and set up PWA install prompt handling.
 * Safe to call in non-browser environments (no-ops gracefully).
 */
export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        console.log('[SW] Registered with scope:', registration.scope);

        // Check for updates on navigation
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[SW] Update available — will activate on next load');
            }
          });
        });
      })
      .catch((err) => {
        console.warn('[SW] Registration failed:', err.message);
      });
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
    const { outcome } = await deferredPrompt.prompt();
    deferredPrompt = null;
    return { outcome, platform: deferredPrompt?.platform || 'web' };
  } catch (err) {
    deferredPrompt = null;
    throw err;
  }
}
