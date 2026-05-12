/**
 * server/email.js — thin Resend HTTP client wrapper.
 *
 * No-ops cleanly when RESEND_API_KEY is unset, so callers can fire-and-forget
 * during local dev without env vars set. In production set:
 *   RESEND_API_KEY=re_xxx
 *   MAPR_EMAIL_FROM="Mapr Alerts <alerts@mapr.example>"
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.MAPR_EMAIL_FROM || 'Mapr <alerts@mapr.local>';
const RESEND_URL = 'https://api.resend.com/emails';

export function isEmailConfigured() {
  return Boolean(RESEND_API_KEY);
}

/**
 * Send an email through Resend. Returns the Resend response, or a
 * `{ skipped: true }` object when not configured.
 */
export async function sendEmail({ to, subject, html, text, replyTo, headers } = {}) {
  if (!RESEND_API_KEY) {
    return { skipped: true, reason: 'RESEND_API_KEY_NOT_SET' };
  }
  if (!to || !subject || (!html && !text)) {
    throw Object.assign(new Error('to, subject, and html|text are required'), { statusCode: 400 });
  }

  const body = {
    from: FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text,
  };
  if (replyTo) body.reply_to = replyTo;
  if (headers) body.headers = headers;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const err = new Error(`resend HTTP ${res.status}: ${txt.slice(0, 200)}`);
      err.code = 'EMAIL_HTTP_ERROR';
      err.status = res.status;
      throw err;
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}
