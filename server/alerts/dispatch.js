/**
 * server/alerts/dispatch.js — alert digest builder + dispatcher.
 *
 * Pulls a user's active alert rules from InstantDB, finds matching events
 * since the last digest send, formats a digest email, and ships it via
 * Resend. Honors quietHours and digestSchedule.frequency (instant/daily/weekly).
 *
 * Day-2 path: the scheduler runs every 15 minutes from server/index.js
 * startup. Once BullMQ + Redis land in Sprint C this dispatcher is wrapped
 * in a queue job.
 */

import { ensureDatabase, readActiveEvents } from '../storage.js';
import { getInstantDb } from '../auth.js';
import { sendEmail, isEmailConfigured } from '../email.js';

const SEVERITY_LABEL = (s) => (s >= 70 ? 'CRITICAL' : s >= 40 ? 'ELEVATED' : s >= 20 ? 'WATCH' : 'LOW');

function inQuietHours(quietHours, date = new Date()) {
  if (!quietHours || quietHours.enabled === false) return false;
  const start = Number(quietHours.startHour);
  const end = Number(quietHours.endHour);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const h = date.getUTCHours();
  if (start === end) return false;
  if (start < end) return h >= start && h < end;
  return h >= start || h < end; // wraps midnight
}

function dueNow(rule, now = Date.now()) {
  const sched = rule.digestSchedule || { frequency: 'instant' };
  const last = rule.lastDigestSentAt || 0;
  switch (sched.frequency) {
    case 'instant':
      return true;
    case 'daily':
      return now - last >= 24 * 3600 * 1000;
    case 'weekly':
      return now - last >= 7 * 24 * 3600 * 1000;
    default:
      return now - last >= 6 * 3600 * 1000;
  }
}

function matchesRule(event, rule) {
  if (!event) return false;
  if ((event.severity || 0) < (rule.severityThreshold || 0)) return false;
  if (rule.minConfidence != null) {
    const score = event.confidenceScore ?? event.sourceCredibility ?? 1;
    if (score < rule.minConfidence) return false;
  }
  // Future: apply saved view filters when savedViewId resolves to a view.
  return true;
}

function renderHtmlDigest({ rule, matches, baseUrl }) {
  const rows = matches.map((ev) => `
    <tr>
      <td style="padding:8px 4px;border-bottom:1px solid #eee;">
        <a href="${baseUrl}/event/${encodeURIComponent(ev.id)}" style="color:#1659a6;text-decoration:none;font-weight:500;">
          ${escape(ev.title || 'Untitled')}
        </a>
        <div style="color:#666;font-size:11px;margin-top:2px;">
          ${escape(ev.primaryCountry || ev.isoA2 || '')} ·
          ${SEVERITY_LABEL(ev.severity || 0)} · sev ${Math.round(ev.severity || 0)}
        </div>
      </td>
    </tr>
  `).join('');
  return `<!doctype html>
<html><body style="font:14px/1.6 -apple-system,Helvetica,sans-serif;color:#111;background:#fafafa;padding:24px;">
  <div style="max-width:600px;margin:auto;background:#fff;border:1px solid #ddd;border-radius:4px;padding:20px;">
    <h2 style="margin:0 0 4px;letter-spacing:0.04em;">Mapr alert · ${escape(rule.name || 'rule')}</h2>
    <p style="margin:0 0 16px;color:#666;font-size:12px;">
      ${matches.length} matching event${matches.length === 1 ? '' : 's'} since the last digest.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
      ${rows}
    </table>
    <p style="margin:18px 0 0;color:#888;font-size:11px;">
      You're receiving this because you enabled email digests for "${escape(rule.name || 'rule')}".
      Adjust delivery settings inside Mapr.
    </p>
  </div>
</body></html>`;
}

function renderTextDigest({ rule, matches, baseUrl }) {
  const lines = [
    `Mapr alert · ${rule.name || 'rule'}`,
    `${matches.length} matching event${matches.length === 1 ? '' : 's'} since last digest.`,
    '',
    ...matches.map((ev) => `  • ${ev.title || 'Untitled'} (${SEVERITY_LABEL(ev.severity || 0)} sev ${Math.round(ev.severity || 0)})\n    ${baseUrl}/event/${encodeURIComponent(ev.id)}`),
    '',
    `Manage in Mapr: ${baseUrl}/account`,
  ];
  return lines.join('\n');
}

function escape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function fetchActiveRulesByUser(userId) {
  const db = getInstantDb();
  // Pull rules + the owning user's email via the userAlertRules link.
  const result = await db.query({
    alertRules: {
      $: { where: userId ? { 'owner.id': userId } : {} },
      owner: {},
    },
  });
  const rules = (result?.alertRules || []).filter((r) => r.active !== false && r.channels?.email);
  return rules;
}

async function listAllActiveDigestRules() {
  const db = getInstantDb();
  const result = await db.query({
    alertRules: {
      $: { },
      owner: {},
    },
  });
  return (result?.alertRules || []).filter((r) => r.active !== false && (r.channels?.email || r.channels?.digest));
}

async function markRuleSent(ruleId, sentAt = Date.now()) {
  const db = getInstantDb();
  await db.transact(db.tx.alertRules[ruleId].update({ lastDigestSentAt: sentAt }));
}

export async function dispatchDigestForRule(rule, { baseUrl = process.env.MAPR_PUBLIC_URL || 'https://mapr.app', dryRun = false } = {}) {
  if (!isEmailConfigured() && !dryRun) {
    return { skipped: true, reason: 'EMAIL_NOT_CONFIGURED' };
  }
  if (inQuietHours(rule.quietHours)) {
    return { skipped: true, reason: 'QUIET_HOURS' };
  }
  if (!dueNow(rule)) {
    return { skipped: true, reason: 'NOT_DUE' };
  }

  const since = rule.lastDigestSentAt
    ? new Date(rule.lastDigestSentAt).toISOString()
    : new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const events = await readActiveEvents({ maxAgeHours: 72 });
  const matches = events
    .filter((ev) => new Date(ev.lastUpdatedAt || ev.firstSeenAt || 0).toISOString() > since)
    .filter((ev) => matchesRule(ev, rule))
    .slice(0, 25);

  if (matches.length === 0) {
    return { skipped: true, reason: 'NO_MATCHES' };
  }

  const recipient = rule.emailAddress || rule.owner?.email;
  if (!recipient) {
    return { skipped: true, reason: 'NO_RECIPIENT' };
  }

  const subject = `[Mapr] ${rule.name || 'Alert digest'} · ${matches.length} matches`;
  const html = renderHtmlDigest({ rule, matches, baseUrl });
  const text = renderTextDigest({ rule, matches, baseUrl });

  if (dryRun) {
    return { dryRun: true, recipient, subject, matches: matches.length, sample: matches[0]?.id };
  }

  const sendResult = await sendEmail({ to: recipient, subject, html, text });
  await markRuleSent(rule.id).catch((err) => {
    console.warn('[alerts] mark sent failed:', err.message);
  });
  return { sent: true, recipient, matches: matches.length, providerResult: sendResult };
}

export async function runDigestSweep({ baseUrl, dryRun = false } = {}) {
  let rules = [];
  try { rules = await listAllActiveDigestRules(); }
  catch (err) {
    if (err.code === 'AUTH_NOT_CONFIGURED') return { skipped: true, reason: err.code };
    throw err;
  }
  const results = [];
  for (const rule of rules) {
    try {
      const res = await dispatchDigestForRule(rule, { baseUrl, dryRun });
      results.push({ ruleId: rule.id, ...res });
    } catch (err) {
      results.push({ ruleId: rule.id, error: err.message });
    }
  }
  return { processed: rules.length, results };
}

export { fetchActiveRulesByUser };
