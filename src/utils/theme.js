/**
 * MAPR Theme Utility
 *
 * Manages light/dark theme with:
 *   - System preference detection (prefers-color-scheme) as default
 *   - localStorage persistence (key: mapr:theme)
 *   - data-theme attribute on <html> for CSS variable switching
 *
 * FlatMap.jsx and Globe.jsx already observe data-theme via MutationObserver,
 * so setting the attribute is sufficient to trigger basemap tile changes.
 */

const STORAGE_KEY = 'mapr:theme';
const ATTR = 'data-theme';
const LIGHT = 'light';
const DARK = 'dark';

/**
 * Read the system-level color scheme preference.
 * Returns 'light' or 'dark'. Defaults to 'dark' when running server-side.
 */
export function getSystemTheme() {
  if (typeof window === 'undefined') return DARK;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT;
}

/**
 * Read the stored theme from localStorage.
 * Returns 'light', 'dark', or null if nothing is stored.
 */
function getStoredTheme() {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val === LIGHT || val === DARK) return val;
  } catch { /* localStorage blocked */ }
  return null;
}

/**
 * Persist the chosen theme to localStorage.
 */
function setStoredTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch { /* localStorage blocked */ }
}

/**
 * Apply a theme by setting/removing the data-theme attribute on <html>.
 * The light theme is indicated by data-theme="light"; dark is data-theme="dark".
 * Also sets color-scheme for native browser UI (scrollbars, form controls).
 */
export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute(ATTR, theme);
  document.documentElement.style.colorScheme = theme;
}

/**
 * Get the currently active theme.
 * Priority: stored preference > system preference > 'dark'.
 */
export function getTheme() {
  return getStoredTheme() || getSystemTheme();
}

/**
 * Set a specific theme ('light' or 'dark') and persist the choice.
 */
export function setTheme(theme) {
  applyTheme(theme);
  setStoredTheme(theme);
}

/**
 * Toggle between light and dark themes.
 * Returns the new theme string.
 */
export function toggleTheme() {
  const current = getTheme();
  const next = current === DARK ? LIGHT : DARK;
  setTheme(next);
  return next;
}

/**
 * Initialize the theme on application startup.
 * Call once during app bootstrap (e.g. in main.jsx).
 * Uses stored preference if available, otherwise system preference.
 */
export function initTheme() {
  const stored = getStoredTheme();
  if (stored) {
    applyTheme(stored);
  } else {
    const system = getSystemTheme();
    applyTheme(system);
    // Do NOT persist the system default — only persist explicit user choices.
    // This way, if the user changes their OS theme, the app follows.
  }
}

/**
 * Listen for system theme changes. When the user hasn't made an explicit
 * choice, the theme follows the OS. Returns a cleanup function.
 */
export function listenSystemTheme(onChange) {
  if (typeof window === 'undefined') return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    // Only react if the user hasn't stored a preference
    if (!getStoredTheme()) {
      const theme = mq.matches ? DARK : LIGHT;
      applyTheme(theme);
      onChange?.(theme);
    }
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
