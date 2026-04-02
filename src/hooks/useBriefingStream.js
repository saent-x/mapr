import { useEffect, useRef } from 'react';

const API_BASE = import.meta.env.VITE_MAPR_API_BASE || '/api';

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
    const schedule = () => {
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
    es.onerror = () => {
      /* browser will retry; avoid spamming */
    };

    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, [debounceMs]);
}
