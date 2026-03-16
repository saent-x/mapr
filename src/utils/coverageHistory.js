const STATUS_SCORE = {
  verified: 5,
  developing: 4,
  'low-confidence': 3,
  uncovered: 2,
  'source-sparse': 1,
  'ingestion-risk': 0
};

function normalizeSnapshotEntry(entry) {
  return {
    iso: entry.iso,
    region: entry.region || entry.iso,
    status: entry.status || 'uncovered',
    eventCount: entry.eventCount || 0,
    verifiedCount: entry.verifiedCount || 0,
    maxConfidence: entry.maxConfidence || 0,
    feedCount: entry.feedCount || 0,
    failedFeeds: entry.failedFeeds || 0
  };
}

function toSnapshotMap(snapshot) {
  return new Map((snapshot?.countries || []).map((entry) => {
    const normalized = normalizeSnapshotEntry(entry);
    return [normalized.iso, normalized];
  }));
}

function getRegionTransitions(history, iso, limit = 10) {
  const transitions = [];

  for (let index = 0; index < (history?.length || 0) - 1; index += 1) {
    const current = history[index];
    const previous = history[index + 1];
    const currentEntry = toSnapshotMap(current).get(iso);
    const previousEntry = toSnapshotMap(previous).get(iso);

    if (!currentEntry && !previousEntry) {
      continue;
    }

    const latest = currentEntry || normalizeSnapshotEntry({ iso, region: previousEntry?.region || iso });
    const prior = previousEntry || normalizeSnapshotEntry({ iso, region: latest.region });

    if (latest.status === prior.status) {
      continue;
    }

    const statusDelta = (STATUS_SCORE[latest.status] || 0) - (STATUS_SCORE[prior.status] || 0);
    transitions.push({
      at: current.at,
      comparedAt: previous.at,
      iso,
      region: latest.region,
      fromStatus: prior.status,
      toStatus: latest.status,
      eventDelta: latest.eventCount - prior.eventCount,
      confidenceDelta: latest.maxConfidence - prior.maxConfidence,
      direction: statusDelta >= 0 ? 'up' : 'down'
    });
  }

  return transitions.slice(0, limit);
}

export function buildCoverageSnapshot(diagnostics, at = new Date().toISOString()) {
  return {
    at,
    countries: Object.values(diagnostics?.byIso || {})
      .map((entry) => normalizeSnapshotEntry(entry))
      .sort((left, right) => left.iso.localeCompare(right.iso))
  };
}

export function mergeCoverageHistory(history, snapshot, limit = 48) {
  const nextHistory = [snapshot, ...(history || []).filter((entry) => entry.at !== snapshot.at)];
  return nextHistory.slice(0, limit);
}

export function summarizeCoverageTrends(history) {
  const latest = history?.[0] || null;
  const previous = history?.[1] || null;

  if (!latest) {
    return {
      latestAt: null,
      comparedAt: null,
      risingRegions: [],
      newlyVerifiedRegions: [],
      atRiskRegions: []
    };
  }

  if (!previous) {
    return {
      latestAt: latest.at,
      comparedAt: null,
      risingRegions: [],
      newlyVerifiedRegions: [],
      atRiskRegions: []
    };
  }

  const latestByIso = toSnapshotMap(latest);
  const previousByIso = toSnapshotMap(previous);
  const allIsos = new Set([...latestByIso.keys(), ...previousByIso.keys()]);

  const risingRegions = [];
  const newlyVerifiedRegions = [];
  const atRiskRegions = [];

  allIsos.forEach((iso) => {
    const current = latestByIso.get(iso) || normalizeSnapshotEntry({ iso, region: iso });
    const prior = previousByIso.get(iso) || normalizeSnapshotEntry({ iso, region: current.region });
    const statusDelta = (STATUS_SCORE[current.status] || 0) - (STATUS_SCORE[prior.status] || 0);
    const eventDelta = current.eventCount - prior.eventCount;
    const confidenceDelta = current.maxConfidence - prior.maxConfidence;

    if (
      current.status !== 'ingestion-risk' &&
      (statusDelta >= 2 || eventDelta >= 2 || confidenceDelta >= 12)
    ) {
      risingRegions.push({
        iso,
        region: current.region,
        status: current.status,
        previousStatus: prior.status,
        eventDelta,
        confidenceDelta
      });
    }

    if (current.status === 'verified' && prior.status !== 'verified') {
      newlyVerifiedRegions.push({
        iso,
        region: current.region,
        previousStatus: prior.status,
        eventCount: current.eventCount,
        confidence: current.maxConfidence
      });
    }

    if (current.status === 'ingestion-risk' && prior.status !== 'ingestion-risk') {
      atRiskRegions.push({
        iso,
        region: current.region,
        previousStatus: prior.status,
        failedFeeds: current.failedFeeds,
        feedCount: current.feedCount
      });
    }
  });

  return {
    latestAt: latest.at,
    comparedAt: previous.at,
    risingRegions: risingRegions
      .sort((left, right) => (
        right.eventDelta - left.eventDelta ||
        right.confidenceDelta - left.confidenceDelta ||
        left.region.localeCompare(right.region)
      ))
      .slice(0, 5),
    newlyVerifiedRegions: newlyVerifiedRegions
      .sort((left, right) => (
        right.confidence - left.confidence ||
        right.eventCount - left.eventCount ||
        left.region.localeCompare(right.region)
      ))
      .slice(0, 5),
    atRiskRegions: atRiskRegions
      .sort((left, right) => (
        right.failedFeeds - left.failedFeeds ||
        right.feedCount - left.feedCount ||
        left.region.localeCompare(right.region)
      ))
      .slice(0, 5)
  };
}

function countStatuses(snapshot) {
  const counts = {
    verified: 0,
    developing: 0,
    'low-confidence': 0,
    'ingestion-risk': 0,
    'source-sparse': 0,
    uncovered: 0
  };

  (snapshot?.countries || []).forEach((entry) => {
    const status = entry.status || 'uncovered';
    counts[status] = (counts[status] || 0) + 1;
  });

  return counts;
}

export function summarizeCoverageHistory(history, limit = 8) {
  return (history || [])
    .slice(0, limit)
    .map((snapshot) => {
      const counts = countStatuses(snapshot);
      return {
        at: snapshot.at,
        coveredCountries: counts.verified + counts.developing + counts['low-confidence'],
        verifiedCountries: counts.verified,
        lowConfidenceCountries: counts['low-confidence'],
        ingestionRiskCountries: counts['ingestion-risk'],
        sourceSparseCountries: counts['source-sparse'],
        uncoveredCountries: counts.uncovered
      };
    });
}

export function buildCoverageTransitions(history, limit = 16) {
  const transitions = [];

  for (let index = 0; index < (history?.length || 0) - 1; index += 1) {
    const current = history[index];
    const previous = history[index + 1];
    const currentByIso = toSnapshotMap(current);
    const previousByIso = toSnapshotMap(previous);
    const allIsos = new Set([...currentByIso.keys(), ...previousByIso.keys()]);

    allIsos.forEach((iso) => {
      const latest = currentByIso.get(iso) || normalizeSnapshotEntry({ iso, region: iso });
      const prior = previousByIso.get(iso) || normalizeSnapshotEntry({ iso, region: latest.region });

      if (latest.status === prior.status) {
        return;
      }

      const statusDelta = (STATUS_SCORE[latest.status] || 0) - (STATUS_SCORE[prior.status] || 0);
      transitions.push({
        at: current.at,
        comparedAt: previous.at,
        iso,
        region: latest.region,
        fromStatus: prior.status,
        toStatus: latest.status,
        eventDelta: latest.eventCount - prior.eventCount,
        confidenceDelta: latest.maxConfidence - prior.maxConfidence,
        direction: statusDelta >= 0 ? 'up' : 'down'
      });
    });
  }

  return transitions
    .sort((left, right) => (
      new Date(right.at) - new Date(left.at) ||
      (right.direction === 'down' ? 1 : 0) - (left.direction === 'down' ? 1 : 0) ||
      left.region.localeCompare(right.region)
    ))
    .slice(0, limit);
}

export function getRegionCoverageHistory(history, iso, limit = 10, transitionLimit = 8) {
  const snapshots = (history || [])
    .map((snapshot) => {
      const entry = toSnapshotMap(snapshot).get(iso);
      if (!entry) {
        return null;
      }

      return {
        at: snapshot.at,
        ...entry
      };
    })
    .filter(Boolean)
    .slice(0, limit);

  return {
    iso,
    region: snapshots[0]?.region || iso,
    latestStatus: snapshots[0]?.status || 'uncovered',
    snapshots,
    transitions: getRegionTransitions(history, iso, transitionLimit)
  };
}
