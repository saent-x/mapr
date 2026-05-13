import { useEffect, useRef } from 'react';

const API_BASE = import.meta.env.VITE_MAPR_API_BASE || '/api';
// Stop reconnecting after this many consecutive native retry-failures. The
// browser otherwise reconnects every few seconds forever — useless on a hard
// 401/403/503, and a real battery / network drag.
const MAX_CONSECUTIVE_ERRORS = 6;

function briefingStreamUrl() {
  const path = `${String(API_BASE).replace(/\/$/, '')}/stream`;
  if (path.startsWith('http')) return path;
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * Subscribes to SSE briefing updates and debounces a callback (e.g. refetch briefing).
 * @param {() => void} onBriefingUpdated
 * @param {number} [debounceMs]
 */
export default function useBriefingStream(onBriefingUpdated, debounceMs = 500) {
  const cbRef = useRef(onBriefingUpdated);
  cbRef.current = onBriefingUpdated;

  useEffect(() => {
    const url = briefingStreamUrl();
    let es;
    try {
      es = new EventSource(url);
    } catch {
      return undefined;
    }

    let timer;
    let consecutiveErrors = 0;
    let closed = false;

    const schedule = () => {
      consecutiveErrors = 0; // a successful event resets the retry counter
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          cbRef.current();
        } catch {
          /* ignore */
        }
      }, debounceMs);
    };

    es.addEventListener('briefing-updated', schedule);
    es.onopen = () => { consecutiveErrors = 0; };
    es.onerror = () => {
      if (closed) return;
      // EventSource fires `onerror` whenever the connection drops; the browser
      // auto-retries. If the server is hard-down (401/503), the retries are
      // useless — cap them.
      if (es.readyState === EventSource.CLOSED) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          closed = true;
          try { es.close(); } catch { /* ignore */ }
        }
      }
    };

    return () => {
      closed = true;
      clearTimeout(timer);
      es.close();
    };
  }, [debounceMs]);
}
