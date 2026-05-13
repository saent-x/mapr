/**
 * server/alerts/dailyDigest.js — per-user daily digest builder.
 *
 * Pulls each user's watchlistItems + recent active events from Postgres,
 * filters events that match any watchlist item, then sends an email.
 * Uses the AI client when configured to produce a one-paragraph summary;
 * falls back to a plain bulleted digest when AI is unavailable.
 *
 * Runs every hour from the main server boot. Per-user cadence (daily/weekly)
 * is checked against $users.lastDailyDigestSentAt before sending.
 */

import { readActiveEvents } from '../storage.js';
import { getInstantDb } from '../auth.js';
import { sendEmail, isEmailConfigured } from '../email.js';
import { generate } from '../ai/client.js';
import { matchBeatForUser } from '../beats/match.js';

const SEVERITY_LABEL = (s) => (s >= 70 ? 'CRITICAL' : s >= 40 ? 'ELEVATED' : s >= 20 ? 'WATCH' : 'LOW');

function inQuietHours(quietHours, date = new Date()) {
  if (!quietHours || quietHours.enabled === false) return false;
  const start = Number(quietHours.startHour);
  const end = Number(quietHours.endHour);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
  const h = date.getUTCHours();
  if (start < end) return h >= start && h < end;
  return h >= start || h < end;
}

function eventMatchesItem(event, item) {
  if (!event || !item) return false;
  const text = `${event.title || ''} ${event.category || ''} ${event.summary || ''}`.toLowerCase();
  const region = (event.primaryCountry || event.isoA2 || '').toLowerCase();
  const v = String(item.value || '').toLowerCase();
  switch (item.type) {
    case 'region':
      return region === v || region.includes(v);
    case 'topic':
    case 'keyword':
      return text.includes(v);
    case 'entity': {
      const entities = event.entities || {};
      const all = [
        ...(entities.people || []).map((p) => (typeof p === 'string' ? p : p?.name || '')),
        ...(entities.organizations || []).map((o) => (typeof o === 'string' ? o : o?.name || '')),
        ...(entities.locations || []).map((l) => (typeof l === 'string' ? l : l?.name || '')),
      ];
      return all.some((n) => String(n).toLowerCase().includes(v));
    }
    case 'category':
      return String(event.category || '').toLowerCase() === v;
    case 'severity':
      // value like "critical" / "elevated"
      return SEVERITY_LABEL(event.severity || 0).toLowerCase() === v;
    default:
      return text.includes(v);
  }
}

function bucketize(matches) {
  const byItem = new Map();
  for (const { item, event } of matches) {
    const key = `${item.type}:${item.value}`;
    let bucket = byItem.get(key);
    if (!bucket) {
      bucket = { item, events: [] };
      byItem.set(key, bucket);
    }
    bucket.events.push(event);
  }
  return [...byItem.values()].sort((a, b) => b.events.length - a.events.length);
}

async function fetchUsersWithWatchlists() {
  const db = getInstantDb();
  const result = await db.query({
    $users: {
      $: {},
      watchlistItems: {},
    },
  });
  return (result?.$users || []).filter((u) => Array.isArray(u.watchlistItems) && u.watchlistItems.length > 0);
}

function userCadenceMs(user) {
  // Pro users default to daily; free to weekly. Schema can override via
  // a future digestFrequency field — fall back to daily here.
  const tier = user.subscriptionStatus || 'free';
  if (tier === 'pro' || tier === 'pro_plus') return 24 * 3600 * 1000;
  return 7 * 24 * 3600 * 1000;
}

async function summarizeDigest({ user, buckets }) {
  if (!buckets.length) return null;
  try {
    const result = await generate({
      task: 'daily_digest',
      input: {
        watchlist: buckets.map((b) => ({
          type: b.item.type,
          label: b.item.label || b.item.value,
          eventCount: b.events.length,
          topTitles: b.events.slice(0, 3).map((e) => e.title).filter(Boolean),
        })),
      },
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['headline', 'body'],
        properties: {
          headline: { type: 'string', minLength: 5, maxLength: 140 },
          body: { type: 'string', minLength: 30, maxLength: 700 },
        },
      },
      maxTokens: 320,
      temperature: 0.2,
    });
    return result?.output || null;
  } catch {
    return null;
  }
}

function renderDigestHtml({ user, buckets, beatMatches = [], summary, baseUrl }) {
  const intro = summary?.body
    ? `<p style="margin:0 0 16px;color:#333;">${escape(summary.body)}</p>`
    : `<p style="margin:0 0 16px;color:#333;">${buckets.length} of your watchlist items had new matches in the last day.</p>`;
  const bucketHtml = buckets.map((b) => {
    const items = b.events.slice(0, 5).map((ev) => `
      <li style="margin:4px 0;">
        <a href="${baseUrl}/event/${encodeURIComponent(ev.id)}" style="color:#1659a6;text-decoration:none;">${escape(ev.title || 'Untitled')}</a>
        <span style="color:#888;font-size:11px;"> · ${SEVERITY_LABEL(ev.severity || 0)} sev ${Math.round(ev.severity || 0)}</span>
      </li>
    `).join('');
    return `
      <section style="margin:18px 0;">
        <h3 style="font-size:14px;margin:0 0 8px;letter-spacing:0.04em;color:#111;">
          ${escape(b.item.label || b.item.value)} <span style="color:#888;font-weight:normal;font-size:11px;">· ${b.events.length} match${b.events.length === 1 ? '' : 'es'}</span>
        </h3>
        <ul style="margin:0;padding-left:18px;font-size:13px;">${items}</ul>
      </section>
    `;
  }).join('');
  const beatHtml = beatMatches.length ? `
    <section style="margin:24px 0 18px;">
      <h3 style="font-size:14px;margin:0 0 8px;letter-spacing:0.04em;color:#111;">
        From your beat <span style="color:#888;font-weight:normal;font-size:11px;">· ${beatMatches.length} semantic match${beatMatches.length === 1 ? '' : 'es'}</span>
      </h3>
      <ul style="margin:0;padding-left:18px;font-size:13px;">
        ${beatMatches.slice(0, 8).map((m) => `
          <li style="margin:4px 0;">
            <a href="${m.eventId ? `${baseUrl}/event/${encodeURIComponent(m.eventId)}` : escape(m.url || '#')}"
               style="color:#1659a6;text-decoration:none;">${escape(m.title || 'Untitled')}</a>
            <span style="color:#888;font-size:11px;"> · ${Math.round(m.similarity * 100)}% match${m.source ? ` · ${escape(m.source)}` : ''}</span>
          </li>
        `).join('')}
      </ul>
    </section>` : '';
  return `<!doctype html>
<html><body style="font:14px/1.6 -apple-system,Helvetica,sans-serif;color:#111;background:#fafafa;padding:24px;">
  <div style="max-width:620px;margin:auto;background:#fff;border:1px solid #ddd;border-radius:4px;padding:20px;">
    <h2 style="margin:0 0 4px;">${escape(summary?.headline || 'Your Mapr daily digest')}</h2>
    <p style="margin:0 0 12px;color:#666;font-size:12px;">Hi ${escape(user.email || '')} — here's what your watchlist and beat surfaced.</p>
    ${intro}
    ${bucketHtml || (beatMatches.length ? '' : '<p>No new matches in this digest window.</p>')}
    ${beatHtml}
    <p style="margin-top:18px;color:#888;font-size:11px;">
      <a href="${baseUrl}/account" style="color:#888;">Manage your digest schedule, watchlist, and beat in Mapr.</a>
    </p>
  </div>
</body></html>`;
}

function renderDigestText({ user, buckets, beatMatches = [], summary, baseUrl }) {
  const lines = [
    summary?.headline || 'Your Mapr daily digest',
    '',
    summary?.body || `${buckets.length} of your watchlist items had new matches in the last day.`,
    '',
  ];
  for (const b of buckets) {
    lines.push(`• ${b.item.label || b.item.value} (${b.events.length} matches)`);
    for (const ev of b.events.slice(0, 5)) {
      lines.push(`    – ${ev.title || 'Untitled'} — ${baseUrl}/event/${encodeURIComponent(ev.id)}`);
    }
    lines.push('');
  }
  if (beatMatches.length) {
    lines.push(`From your beat (${beatMatches.length} semantic matches)`);
    for (const m of beatMatches.slice(0, 8)) {
      const url = m.eventId ? `${baseUrl}/event/${encodeURIComponent(m.eventId)}` : (m.url || '');
      lines.push(`    – ${m.title || 'Untitled'} — ${Math.round(m.similarity * 100)}% match — ${url}`);
    }
    lines.push('');
  }
  lines.push(`Manage: ${baseUrl}/account`);
  return lines.join('\n');
}

function escape(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function markUserDigestSent(userId, ts = Date.now()) {
  const db = getInstantDb();
  try { await db.transact(db.tx.$users[userId].update({ lastDailyDigestSentAt: ts })); }
  catch (err) {
    if (process.env.NODE_ENV !== 'test') console.warn('[digest] mark sent failed:', err.message);
  }
}

export async function buildDigestForUser(user, { baseUrl = process.env.MAPR_PUBLIC_URL || 'https://mapr.app', dryRun = false } = {}) {
  if (!user?.id || !user.email) return { skipped: true, reason: 'NO_USER_EMAIL' };
  // A user with no watchlist AND no beat profile has nothing to digest;
  // a beat profile alone is enough to send the digest.
  const cadence = userCadenceMs(user);
  const last = user.lastDailyDigestSentAt || 0;
  if (Date.now() - last < cadence) {
    return { skipped: true, reason: 'NOT_DUE' };
  }
  if (inQuietHours(user.quietHours)) {
    return { skipped: true, reason: 'QUIET_HOURS' };
  }

  const sinceIso = last ? new Date(last).toISOString() : new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const events = await readActiveEvents({ maxAgeHours: 48 });
  const recent = events.filter((ev) => new Date(ev.lastUpdatedAt || ev.firstSeenAt || 0).toISOString() > sinceIso);

  const matches = [];
  for (const item of (user.watchlistItems || [])) {
    for (const event of recent) {
      if (eventMatchesItem(event, item)) matches.push({ item, event });
    }
  }

  // D2: beat-matched articles for the last 24 h (or since the last
  // digest if it's been less). Pulled directly from articles (not
  // events) so we capture stories that haven't yet been clustered.
  const beatMatches = await matchBeatForUser({
    userId: user.id,
    limit: 8,
    minSimilarity: 0.55,
    sinceIso,
  }).catch(() => []);

  if (matches.length === 0 && beatMatches.length === 0) {
    return { skipped: true, reason: 'NO_MATCHES' };
  }
  const buckets = bucketize(matches);

  if (dryRun) {
    return {
      dryRun: true,
      recipient: user.email,
      buckets: buckets.length,
      totalEvents: matches.length,
      beatMatches: beatMatches.length,
    };
  }
  if (!isEmailConfigured()) return { skipped: true, reason: 'EMAIL_NOT_CONFIGURED' };

  const summary = await summarizeDigest({ user, buckets });
  const html = renderDigestHtml({ user, buckets, beatMatches, summary, baseUrl });
  const text = renderDigestText({ user, buckets, beatMatches, summary, baseUrl });

  const subject = summary?.headline
    ? `[Mapr] ${summary.headline.slice(0, 80)}`
    : `[Mapr] Daily digest · ${matches.length} matches`;

  const sendResult = await sendEmail({ to: user.email, subject, html, text });
  await markUserDigestSent(user.id);
  return { sent: true, recipient: user.email, buckets: buckets.length, totalEvents: matches.length, summarized: Boolean(summary), providerResult: sendResult };
}

export async function runDailyDigestSweep({ baseUrl, dryRun = false } = {}) {
  let users = [];
  try { users = await fetchUsersWithWatchlists(); }
  catch (err) {
    if (err.code === 'AUTH_NOT_CONFIGURED') return { skipped: true, reason: err.code };
    throw err;
  }
  const results = [];
  for (const user of users) {
    try {
      const res = await buildDigestForUser(user, { baseUrl, dryRun });
      results.push({ userId: user.id, ...res });
    } catch (err) {
      results.push({ userId: user.id, error: err.message });
    }
  }
  return { processed: users.length, results };
}
