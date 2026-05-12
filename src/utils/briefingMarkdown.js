/**
 * briefingMarkdown.js — generates a markdown briefing report from events.
 *
 * Produces clipboard-ready markdown with:
 *  - ISO-8601 timestamp and active filter summary
 *  - Severity distribution (Critical/Elevated/Watch/Low counts)
 *  - Top events grouped by severity tier
 *  - Entity mentions extracted from event entities
 *  - Coverage stats (per-region source status)
 *  - Footer with generation metadata
 */

const SEVERITY_TIERS = [
  { label: 'Critical', min: 85 },
  { label: 'Elevated', min: 60 },
  { label: 'Watch', min: 35 },
  { label: 'Low', min: 0 },
];

/**
 * Returns a human-readable severity label for a numeric score.
 * @param {number} severity
 * @returns {string}
 */
export function severityLabel(severity) {
  if (severity >= 85) return 'Critical';
  if (severity >= 60) return 'Elevated';
  if (severity >= 35) return 'Watch';
  return 'Low';
}

/**
 * Formats a date string or timestamp into a readable format.
 * @param {string|number|undefined} dateVal
 * @returns {string}
 */
function formatDate(dateVal) {
  if (!dateVal) return '—';
  try {
    const d = new Date(dateVal);
    return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  } catch {
    return '—';
  }
}

function entityTypeFromGroup(group) {
  if (group === 'people') return 'person';
  if (group === 'organizations') return 'organization';
  if (group === 'locations') return 'location';
  return group || 'unknown';
}

function normalizeEntity(entity, fallbackType) {
  if (!entity) return null;
  if (typeof entity === 'string') return { name: entity, type: fallbackType || 'unknown' };
  if (typeof entity !== 'object') return null;
  const name = entity.name || entity.text || entity.label || entity.value;
  if (!name) return null;
  return {
    ...entity,
    name,
    type: entity.type || fallbackType || 'unknown',
  };
}

export function getEventEntityList(event = {}) {
  const rawEntities = event.entities || event.enrichedEntities || [];
  if (Array.isArray(rawEntities)) {
    return rawEntities
      .map((entity) => normalizeEntity(entity))
      .filter(Boolean);
  }
  if (!rawEntities || typeof rawEntities !== 'object') return [];

  return Object.entries(rawEntities).flatMap(([group, value]) => {
    if (!Array.isArray(value)) return [];
    const fallbackType = entityTypeFromGroup(group);
    return value
      .map((entity) => normalizeEntity(entity, fallbackType))
      .filter(Boolean);
  });
}

/**
 * Extracts unique entity mentions from events, sorted by frequency.
 * @param {object[]} events
 * @returns {{ name: string, type: string, count: number }[]}
 */
export function extractEntityMentions(events) {
  const entityMap = new Map();
  for (const event of events) {
    const entities = getEventEntityList(event);
    for (const entity of entities) {
      const name = entity.name?.trim() || entity.text?.trim();
      if (!name || name.length < 2) continue;
      const key = `${name.toLowerCase()}::${entity.type || 'unknown'}`;
      if (!entityMap.has(key)) {
        entityMap.set(key, { name, type: entity.type || 'unknown', count: 0 });
      }
      entityMap.get(key).count++;
    }
  }
  return Array.from(entityMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
}

/**
 * Builds active filter summary string.
 * @param {object} filters
 * @returns {string}
 */
export function buildFilterSummary(filters = {}) {
  const parts = [];
  if (filters.dateWindow && filters.dateWindow !== '168h') parts.push(`Time window: ${filters.dateWindow}`);
  if (filters.minSeverity != null && filters.minSeverity > 0) parts.push(`Min severity: ${filters.minSeverity}`);
  if (filters.minConfidence != null && filters.minConfidence > 0) parts.push(`Min confidence: ${filters.minConfidence}%`);
  if (filters.sortMode && filters.sortMode !== 'severity') parts.push(`Sort: ${filters.sortMode}`);
  if (filters.verificationFilter && filters.verificationFilter !== 'all') parts.push(`Verification: ${filters.verificationFilter}`);
  if (filters.sourceTypeFilter && filters.sourceTypeFilter !== 'all') parts.push(`Source type: ${filters.sourceTypeFilter}`);
  if (filters.languageFilter && filters.languageFilter !== 'all') parts.push(`Language: ${filters.languageFilter}`);
  if (filters.entityFilter?.name) parts.push(`Entity: ${filters.entityFilter.name}`);
  if (filters.hideAmplified) parts.push('Amplified: hidden');
  if (filters.region) parts.push(`Region: ${filters.region}`);
  if (filters.searchQuery) parts.push(`Search: "${filters.searchQuery}"`);
  if (parts.length === 0) return 'None active (default view)';
  return parts.join(' · ');
}

/**
 * Generates markdown text summarizing the given events.
 *
 * @param {object[]} events – array of canonical event objects
 * @param {object}   filters – active filter configuration
 * @returns {string} markdown content
 */
export function generateBriefingMarkdown(events = [], filters = {}) {
  const now = new Date();
  const lines = [];

  // ── Header ──
  lines.push('# MAPR Intelligence Briefing');
  lines.push('');
  lines.push(`**Generated:** ${now.toISOString()}`);
  lines.push(`**Events:** ${events.length}`);
  lines.push('');

  // ── Filter summary ──
  const filterSummary = buildFilterSummary(filters);
  lines.push(`**Active Filters:** ${filterSummary}`);
  lines.push('');

  // ── Severity Summary ──
  const regions = new Set();
  let totalSources = 0;
  const severityCounts = { Critical: 0, Elevated: 0, Watch: 0, Low: 0 };

  for (const event of events) {
    if (event.region) regions.add(event.region);
    if (event.isoA2) regions.add(event.isoA2);
    totalSources += event.articleCount || 1;
    const label = severityLabel(event.severity || 0);
    severityCounts[label] = (severityCounts[label] || 0) + 1;
  }

  lines.push('## Severity Summary');
  lines.push('');
  lines.push(`| Tier | Count |`);
  lines.push(`| ---- | ----- |`);
  lines.push(`| CRITICAL | ${severityCounts.Critical} |`);
  lines.push(`| ELEVATED | ${severityCounts.Elevated} |`);
  lines.push(`| WATCH | ${severityCounts.Watch} |`);
  lines.push(`| LOW | ${severityCounts.Low} |`);
  lines.push('');

  // ── Coverage Stats ──
  const regionCoverage = new Map();
  for (const event of events) {
    const rgn = event.region || 'none';
    if (!regionCoverage.has(rgn)) {
      regionCoverage.set(rgn, { count: 0, sources: 0 });
    }
    const entry = regionCoverage.get(rgn);
    entry.count++;
    entry.sources += event.articleCount || 1;
  }
  lines.push('## Coverage Stats');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| ------ | ----- |`);
  lines.push(`| Total events | ${events.length} |`);
  lines.push(`| Regions covered | ${regions.size} |`);
  lines.push(`| Total source articles | ${totalSources} |`);
  lines.push('');

  if (regionCoverage.size > 0) {
    lines.push('### Region Coverage');
    lines.push('');
    lines.push('| Region | Events | Sources |');
    lines.push('| ------ | ------ | ------- |');
    const sorted = Array.from(regionCoverage.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20);
    for (const [iso, stats] of sorted) {
      lines.push(`| ${iso.toUpperCase()} | ${stats.count} | ${stats.sources} |`);
    }
    lines.push('');
  }

  // ── Top Events by severity tier ──
  lines.push('## Top Events');
  lines.push('');
  for (const tier of SEVERITY_TIERS) {
    const tierEvents = events.filter((e) => severityLabel(e.severity || 0) === tier.label);
    if (tierEvents.length === 0) continue;

    lines.push(`### ${tier.label} Events (${tierEvents.length})`);
    lines.push('');
    lines.push('| # | Title | Severity | Region | Sources | First Seen |');
    lines.push('| - | ----- | -------- | ------ | ------- | ---------- |');

    tierEvents.slice(0, 20).forEach((event, idx) => {
      const title = (event.title || 'Untitled').replace(/\|/g, '\\|');
      const region = (event.region || event.locality || event.isoA2 || '—').replace(/\|/g, '\\|');
      const sources = event.articleCount || 1;
      const firstSeen = formatDate(event.firstSeenAt);
      lines.push(`| ${idx + 1} | ${title} | ${event.severity || 0} | ${region} | ${sources} | ${firstSeen} |`);
    });

    lines.push('');
  }

  // ── Entity Mentions ──
  const entities = extractEntityMentions(events);
  if (entities.length > 0) {
    lines.push('## Entity Mentions');
    lines.push('');
    lines.push('| Entity | Type | Events |');
    lines.push('| ------ | ---- | ------ |');
    for (const entity of entities.slice(0, 20)) {
      const name = entity.name.replace(/\|/g, '\\|');
      lines.push(`| ${name} | ${entity.type.toUpperCase()} | ${entity.count} |`);
    }
    lines.push('');
  } else {
    lines.push('## Entity Mentions');
    lines.push('');
    lines.push('*No named entities found in filtered events.*');
    lines.push('');
  }

  // ── Footer ──
  lines.push('---');
  lines.push('');
  lines.push('*Generated by [MAPR OSINT Platform](https://github.com/tor/mapr)*');
  lines.push('');

  return lines.join('\n');
}
