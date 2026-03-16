const HOUR_MS = 60 * 60 * 1000;

const SEVERITY_RANK = {
  critical: 0,
  warning: 1,
  info: 2
};

function sortAlerts(left, right) {
  return (
    (SEVERITY_RANK[left.severity] ?? 99) - (SEVERITY_RANK[right.severity] ?? 99)
    || (right.count || 0) - (left.count || 0)
    || left.code.localeCompare(right.code)
  );
}

function sortRegionLag(left, right) {
  return (
    right.ageHours - left.ageHours
    || right.eventCount - left.eventCount
    || left.region.localeCompare(right.region)
  );
}

export function buildRegionLagDiagnostics(events, {
  now = Date.now(),
  watchHours = 24,
  staleHours = 72
} = {}) {
  const byIso = {};

  (events || []).forEach((event) => {
    if (!event?.isoA2 || event.isoA2 === 'XX') {
      return;
    }

    const eventTime = new Date(event.lastSeenAt || event.publishedAt || 0).getTime();
    if (!Number.isFinite(eventTime) || eventTime <= 0) {
      return;
    }

    const current = byIso[event.isoA2] || {
      iso: event.isoA2,
      region: event.region || event.isoA2,
      eventCount: 0,
      maxSeverity: 0,
      lastSeenAt: null,
      ageHours: 0,
      lagStatus: 'fresh'
    };

    current.eventCount += 1;
    current.maxSeverity = Math.max(current.maxSeverity, event.severity || 0);

    if (!current.lastSeenAt || new Date(current.lastSeenAt).getTime() < eventTime) {
      current.lastSeenAt = new Date(eventTime).toISOString();
    }

    byIso[event.isoA2] = current;
  });

  const entries = Object.values(byIso)
    .map((entry) => {
      const lastSeenTime = new Date(entry.lastSeenAt).getTime();
      const ageHours = Math.max(0, Math.round((now - lastSeenTime) / HOUR_MS));
      let lagStatus = 'fresh';

      if (ageHours >= staleHours) {
        lagStatus = 'stale';
      } else if (ageHours >= watchHours) {
        lagStatus = 'watch';
      }

      return {
        ...entry,
        ageHours,
        lagStatus
      };
    })
    .sort(sortRegionLag);

  entries.forEach((entry) => {
    byIso[entry.iso] = entry;
  });

  return {
    byIso,
    staleRegions: entries.filter((entry) => entry.lagStatus === 'stale'),
    watchRegions: entries.filter((entry) => entry.lagStatus === 'watch'),
    stats: {
      staleCount: entries.filter((entry) => entry.lagStatus === 'stale').length,
      watchCount: entries.filter((entry) => entry.lagStatus === 'watch').length,
      freshCount: entries.filter((entry) => entry.lagStatus === 'fresh').length
    }
  };
}

export function buildOpsAlerts({
  backendHealth = null,
  sourceHealth = null,
  coverageDiagnostics = null,
  regionLagDiagnostics = null
} = {}) {
  const alerts = [];
  const snapshotAgeHours = backendHealth?.snapshotAgeMs
    ? Math.round(backendHealth.snapshotAgeMs / HOUR_MS)
    : 0;

  if (backendHealth?.status === 'stale') {
    alerts.push({
      id: 'backend-stale',
      code: 'backendStale',
      scope: 'backend',
      severity: 'critical',
      count: snapshotAgeHours,
      vars: { hours: snapshotAgeHours }
    });
  }

  if ((backendHealth?.consecutiveFailures || 0) > 0) {
    alerts.push({
      id: 'backend-failures',
      code: 'backendFailures',
      scope: 'backend',
      severity: backendHealth.consecutiveFailures >= 3 ? 'critical' : 'warning',
      count: backendHealth.consecutiveFailures,
      vars: { count: backendHealth.consecutiveFailures }
    });
  }

  if ((sourceHealth?.rss?.failedFeeds || 0) > 0) {
    alerts.push({
      id: 'rss-failures',
      code: 'rssFailures',
      scope: 'rss',
      severity: (sourceHealth?.rss?.healthyFeeds || 0) === 0 ? 'critical' : 'warning',
      count: sourceHealth.rss.failedFeeds,
      vars: {
        failed: sourceHealth.rss.failedFeeds,
        total: sourceHealth.rss.totalFeeds || 0
      }
    });
  }

  if ((sourceHealth?.gdelt?.failedProfiles || 0) > 0) {
    alerts.push({
      id: 'gdelt-failures',
      code: 'gdeltFailures',
      scope: 'gdelt',
      severity: (sourceHealth?.gdelt?.healthyProfiles || 0) === 0 ? 'critical' : 'warning',
      count: sourceHealth.gdelt.failedProfiles,
      vars: {
        failed: sourceHealth.gdelt.failedProfiles,
        total: sourceHealth.gdelt.totalProfiles || 0
      }
    });
  }

  const ingestionRiskCountries = coverageDiagnostics?.diagnosticCounts?.ingestionRiskCountries || 0;
  if (ingestionRiskCountries > 0) {
    alerts.push({
      id: 'ingestion-risk',
      code: 'ingestionRisk',
      scope: 'coverage',
      severity: ingestionRiskCountries >= 5 ? 'critical' : 'warning',
      count: ingestionRiskCountries,
      vars: { count: ingestionRiskCountries }
    });
  }

  const sourceSparseCountries = coverageDiagnostics?.diagnosticCounts?.sourceSparseCountries || 0;
  if (sourceSparseCountries > 0) {
    alerts.push({
      id: 'source-sparse',
      code: 'sourceSparse',
      scope: 'coverage',
      severity: sourceSparseCountries >= 40 ? 'warning' : 'info',
      count: sourceSparseCountries,
      vars: { count: sourceSparseCountries }
    });
  }

  const staleRegions = regionLagDiagnostics?.stats?.staleCount || 0;
  if (staleRegions > 0) {
    alerts.push({
      id: 'stale-region-lag',
      code: 'staleRegionLag',
      scope: 'regions',
      severity: staleRegions >= 5 ? 'warning' : 'info',
      count: staleRegions,
      vars: { count: staleRegions }
    });
  }

  const orderedAlerts = alerts.sort(sortAlerts);

  return {
    alerts: orderedAlerts,
    summary: {
      criticalCount: orderedAlerts.filter((alert) => alert.severity === 'critical').length,
      warningCount: orderedAlerts.filter((alert) => alert.severity === 'warning').length,
      infoCount: orderedAlerts.filter((alert) => alert.severity === 'info').length
    }
  };
}
