/**
 * Single implementation of the briefing load ladder: backend (incl. 503 warming) → client GDELT → failure.
 * Used by newsStore and useEventData to avoid duplicated logic.
 */

import {
  fetchBackendBriefingRaw,
  fetchBackendCoverageHistory,
  refreshBackendBriefingRaw,
} from './backendService.js';
import { fetchLiveNews, getGdeltFetchHealth } from './gdeltService.js';

/**
 * @param {{ forceRefresh?: boolean }} opts
 * @returns {Promise<
 *   | { kind: 'backend'; briefing: object; historyPayload: object | null }
 *   | { kind: 'backend_warming'; briefing: object; historyPayload: object | null }
 *   | { kind: 'client_gdelt'; articles: object[]; gdeltHealth: object | null }
 *   | { kind: 'unavailable'; errorMessage: string }
 * >}
 */
export async function runLoadLiveDataPipeline({ forceRefresh = false } = {}) {
  try {
    const raw = forceRefresh ? await refreshBackendBriefingRaw() : await fetchBackendBriefingRaw();
    const briefing = raw.data;

    if (raw.status === 503 && briefing && typeof briefing === 'object') {
      const warmingArticles = briefing.articles || [];
      // Only return backend_warming if we actually have articles to show;
      // fall through to GDELT / unavailable when backend returns 503 with 0 articles.
      if (warmingArticles.length > 0) {
        let historyPayload = null;
        try {
          historyPayload = await fetchBackendCoverageHistory();
        } catch {
          historyPayload = null;
        }
        return { kind: 'backend_warming', briefing, historyPayload };
      }
    }

    if (raw.ok && briefing && Array.isArray(briefing.articles)) {
      const hasArticles = briefing.articles.length > 0;
      const hasSnapshot = Boolean(briefing.meta?.fetchedAt) || hasArticles;
      let historyPayload = null;
      try {
        historyPayload = await fetchBackendCoverageHistory();
      } catch {
        historyPayload = null;
      }

      if (hasSnapshot) {
        return { kind: 'backend', briefing, historyPayload };
      }
    }

    if (!raw.ok) {
      throw new Error(briefing?.error || `Backend HTTP ${raw.status}`);
    }
  } catch (err) {
    console.warn('Backend briefing failed, trying client-side GDELT fallback:', err.message);
  }

  try {
    const clientArticles = await fetchLiveNews({ timespan: '24h', maxRecords: 750 });
    if (Array.isArray(clientArticles) && clientArticles.length > 0) {
      return {
        kind: 'client_gdelt',
        articles: clientArticles,
        gdeltHealth: getGdeltFetchHealth(),
      };
    }
  } catch (err) {
    console.warn('Client-side GDELT fallback also failed:', err.message);
  }

  return { kind: 'unavailable', errorMessage: 'Both backend and client-side fetching failed' };
}
