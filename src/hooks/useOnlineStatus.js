import { useState, useEffect, useCallback } from 'react';
import { loadLastSnapshot } from '../services/eventCache.js';
import { formatDate } from '../utils/formatDate.js';

/**
 * Hook that tracks browser online/offline status and the last-updated
 * timestamp from the IndexedDB event snapshot cache.
 *
 * @returns {{
 *   isOnline: boolean,
 *   isOffline: boolean,
 *   lastUpdatedAt: string|null,  // ISO timestamp of last cached snapshot
 *   lastUpdatedAge: string|null, // human-readable relative time
 * }}
 */
export default function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [lastUpdatedAge, setLastUpdatedAge] = useState(null);

  // Listen for online/offline events
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Load last-updated timestamp from IndexedDB when going offline
  useEffect(() => {
    if (isOnline) return;

    let cancelled = false;
    loadLastSnapshot().then((snap) => {
      if (cancelled || !snap?.savedAt) return;
      setLastUpdatedAt(snap.savedAt);
      setLastUpdatedAge(formatRelativeTime(snap.savedAt));
    }).catch(() => {
      // IndexedDB unavailable — no cached timestamp
    });

    return () => { cancelled = true; };
  }, [isOnline]);

  // Refresh the relative time display every 30 seconds
  useEffect(() => {
    if (!lastUpdatedAt) return;

    const id = setInterval(() => {
      setLastUpdatedAge(formatRelativeTime(lastUpdatedAt));
    }, 30000);

    return () => clearInterval(id);
  }, [lastUpdatedAt]);

  const refreshTimestamp = useCallback(async () => {
    try {
      const snap = await loadLastSnapshot();
      if (snap?.savedAt) {
        setLastUpdatedAt(snap.savedAt);
        setLastUpdatedAge(formatRelativeTime(snap.savedAt));
      }
    } catch { /* ignore */ }
  }, []);

  return {
    isOnline,
    isOffline: !isOnline,
    lastUpdatedAt,
    lastUpdatedAge,
    refreshTimestamp,
  };
}

/**
 * Format an ISO timestamp as a human-readable relative time string.
 * Examples: "just now", "3 minutes ago", "1 hour ago", "2 days ago"
 *
 * @param {string} isoTimestamp
 * @returns {string}
 */
function formatRelativeTime(isoTimestamp) {
  const then = new Date(isoTimestamp).getTime();
  const now = Date.now();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';
  if (diffMs < 60000) return 'just now';

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  }

  try {
    // Use the i18n-aware formatter that respects the selected language
    return formatDate(isoTimestamp);
  } catch {
    return new Date(isoTimestamp).toLocaleDateString();
  }
}

export { formatRelativeTime };
