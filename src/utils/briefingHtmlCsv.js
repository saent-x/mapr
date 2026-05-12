import { severityLabel } from './briefingMarkdown.js';

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function isoOrEmpty(dateVal) {
  if (!dateVal) return '';
  const ts = typeof dateVal === 'number' ? dateVal : Date.parse(dateVal);
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toISOString();
}

function downloadBlob(filename, mime, content) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function flattenEntities(event) {
  const ents = event?.entities || {};
  const get = (k) => Array.isArray(ents[k]) ? ents[k].map((e) => (typeof e === 'string' ? e : e?.name)).filter(Boolean) : [];
  return {
    people: get('people'),
    organizations: get('organizations'),
    locations: get('locations'),
  };
}

function severityCounts(events) {
  const tiers = { Critical: 0, Elevated: 0, Watch: 0, Low: 0 };
  for (const ev of events) tiers[severityLabel(ev.severity ?? 0)] += 1;
  return tiers;
}

function regionCounts(events) {
  const map = new Map();
  for (const ev of events) {
    const r = ev.region || ev.primaryCountry || ev.isoA2 || 'Unknown';
    map.set(r, (map.get(r) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export function generateBriefingCsv(events = [], filters = {}) {
  const header = [
    'id', 'title', 'severity', 'severityTier', 'category', 'lifecycle',
    'region', 'isoA2', 'lat', 'lon', 'source', 'url',
    'publishedAt', 'firstSeenAt',
    'people', 'organizations', 'locations',
    'summary',
  ];
  const rows = [header.join(',')];
  for (const ev of events) {
    const ents = flattenEntities(ev);
    const lat = Array.isArray(ev.coordinates) ? ev.coordinates[1] : '';
    const lon = Array.isArray(ev.coordinates) ? ev.coordinates[0] : '';
    rows.push([
      csvEscape(ev.id),
      csvEscape(ev.title),
      csvEscape(ev.severity ?? ''),
      csvEscape(severityLabel(ev.severity ?? 0)),
      csvEscape(ev.category || ''),
      csvEscape(ev.lifecycle || ''),
      csvEscape(ev.region || ev.primaryCountry || ''),
      csvEscape(ev.isoA2 || ''),
      csvEscape(lat),
      csvEscape(lon),
      csvEscape(ev.source || ''),
      csvEscape(ev.url || ''),
      csvEscape(isoOrEmpty(ev.publishedAt)),
      csvEscape(isoOrEmpty(ev.firstSeenAt)),
      csvEscape(ents.people.join('|')),
      csvEscape(ents.organizations.join('|')),
      csvEscape(ents.locations.join('|')),
      csvEscape(ev.summary || ''),
    ].join(','));
  }
  // Prepend filter metadata as a leading comment row.
  const filterSummary = Object.entries(filters || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('; ');
  return `# Mapr briefing · ${new Date().toISOString()} · ${events.length} events · filters: ${filterSummary || 'none'}\n${rows.join('\n')}`;
}

export function generateBriefingHtml(events = [], filters = {}) {
  const ts = new Date().toISOString();
  const counts = severityCounts(events);
  const regions = regionCounts(events).slice(0, 12);
  const sorted = [...events].sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));

  const filterSummary = Object.entries(filters || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && !(typeof v === 'object' && Object.keys(v).length === 0))
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : v)}</dd>`)
    .join('');

  const eventCard = (ev, idx) => {
    const ents = flattenEntities(ev);
    const entityLine = [
      ents.people.length ? `<strong>People:</strong> ${ents.people.slice(0, 6).map(escapeHtml).join(', ')}` : '',
      ents.organizations.length ? `<strong>Orgs:</strong> ${ents.organizations.slice(0, 6).map(escapeHtml).join(', ')}` : '',
      ents.locations.length ? `<strong>Places:</strong> ${ents.locations.slice(0, 6).map(escapeHtml).join(', ')}` : '',
    ].filter(Boolean).join(' &middot; ');
    return `
      <article class="event-card sev-${severityLabel(ev.severity ?? 0).toLowerCase()}">
        <header>
          <span class="sev-pill">${severityLabel(ev.severity ?? 0)} · ${Math.round(ev.severity ?? 0)}</span>
          ${ev.category ? `<span class="cat">${escapeHtml(String(ev.category).toUpperCase())}</span>` : ''}
          ${ev.region || ev.primaryCountry ? `<span class="region">${escapeHtml(ev.region || ev.primaryCountry)}</span>` : ''}
        </header>
        <h3>[${idx + 1}] ${escapeHtml(ev.title || 'Untitled')}</h3>
        ${ev.summary ? `<p class="summary">${escapeHtml(ev.summary)}</p>` : ''}
        ${entityLine ? `<p class="entities">${entityLine}</p>` : ''}
        <footer>
          ${ev.source ? `<span>${escapeHtml(ev.source)}</span>` : ''}
          ${ev.publishedAt ? `<time datetime="${escapeHtml(isoOrEmpty(ev.publishedAt))}">${escapeHtml(isoOrEmpty(ev.publishedAt))}</time>` : ''}
          ${ev.url ? `<a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener noreferrer">↗ source</a>` : ''}
        </footer>
      </article>
    `;
  };

  const regionRows = regions
    .map(([r, n]) => `<tr><td>${escapeHtml(r)}</td><td>${n}</td></tr>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Mapr briefing · ${escapeHtml(ts)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.6 -apple-system, "Segoe UI", Helvetica, sans-serif; margin: 32px auto; max-width: 900px; color: #111; background: #fff; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.02em; }
  h2 { font-size: 16px; margin: 28px 0 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #555; }
  h3 { font-size: 15px; margin: 0 0 6px; }
  header.report { color: #555; font-size: 12px; margin-bottom: 24px; }
  dl.filters { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; font-size: 12px; margin: 8px 0 0; }
  dl.filters dt { color: #888; }
  table.sev, table.regions { border-collapse: collapse; font-size: 13px; }
  table.sev td, table.regions td { padding: 2px 12px 2px 0; }
  article.event-card { border: 1px solid #ddd; border-radius: 4px; padding: 12px 14px; margin: 8px 0; }
  article.event-card header { font-size: 11px; color: #666; display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
  article.event-card .sev-pill { padding: 1px 6px; border-radius: 2px; background: #f3f3f3; }
  article.event-card.sev-critical .sev-pill { background: #ffe0e0; color: #aa1111; }
  article.event-card.sev-elevated .sev-pill { background: #ffe9c2; color: #8a4d00; }
  article.event-card.sev-watch    .sev-pill { background: #fff4cd; color: #886a00; }
  article.event-card .summary { color: #333; }
  article.event-card .entities { font-size: 12px; color: #555; }
  article.event-card footer { font-size: 11px; color: #777; display: flex; gap: 12px; margin-top: 6px; flex-wrap: wrap; }
  article.event-card footer a { color: #1659a6; }
  @media print { body { margin: 12mm; } article.event-card { break-inside: avoid; } }
</style>
</head>
<body>
  <header class="report">
    <h1>Mapr briefing</h1>
    <div>Generated ${escapeHtml(ts)} · ${events.length} events</div>
    ${filterSummary ? `<dl class="filters">${filterSummary}</dl>` : ''}
  </header>

  <h2>Severity distribution</h2>
  <table class="sev">
    <tbody>
      <tr><td>Critical</td><td>${counts.Critical}</td></tr>
      <tr><td>Elevated</td><td>${counts.Elevated}</td></tr>
      <tr><td>Watch</td><td>${counts.Watch}</td></tr>
      <tr><td>Low</td><td>${counts.Low}</td></tr>
    </tbody>
  </table>

  ${regions.length ? `<h2>Top regions</h2>
  <table class="regions">
    <thead><tr><th>Region</th><th>Events</th></tr></thead>
    <tbody>${regionRows}</tbody>
  </table>` : ''}

  <h2>Events</h2>
  ${sorted.map(eventCard).join('\n')}

  <footer style="font-size:11px;color:#888;margin-top:32px;">
    Generated by Mapr · ${escapeHtml(ts)}
  </footer>
</body>
</html>`;
}

export function exportBriefingCsv(events, filters, filename = 'mapr-briefing.csv') {
  downloadBlob(filename, 'text/csv;charset=utf-8', generateBriefingCsv(events, filters));
}

export function exportBriefingHtml(events, filters, filename = 'mapr-briefing.html') {
  downloadBlob(filename, 'text/html;charset=utf-8', generateBriefingHtml(events, filters));
}
