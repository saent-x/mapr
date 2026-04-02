/**
 * Signed httpOnly-cookie session for admin routes (no password stored in the browser).
 * Uses ADMIN_SESSION_SECRET if set, else ADMIN_PASSWORD as HMAC key.
 */

import crypto from 'node:crypto';

export const ADMIN_SESSION_COOKIE = 'mapr_admin';
const MAX_AGE_SEC = 3600;

function signingSecret() {
  const s = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD;
  return String(s || '').trim();
}

export function canIssueAdminSession() {
  const adminPw = String(process.env.ADMIN_PASSWORD || '').trim();
  return Boolean(adminPw && signingSecret());
}

/** @returns {string | null} */
export function createSessionToken() {
  const secret = signingSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = Buffer.from(JSON.stringify({ exp }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** @param {string | undefined} token */
export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const secret = signingSecret();
  if (!secret) return false;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  if (sig.length !== expected.length) return false;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'))) {
      return false;
    }
  } catch {
    return false;
  }
  try {
    const json = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (typeof json.exp !== 'number') return false;
    if (json.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

/** @param {string | undefined} cookieHeader */
export function getSessionTokenFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of String(cookieHeader).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === ADMIN_SESSION_COOKIE) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/**
 * @param {boolean} secure — set Secure flag (HTTPS)
 */
export function buildSetSessionCookie(value, secure) {
  let c = `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}`;
  if (secure) c += '; Secure';
  return c;
}

export function buildClearSessionCookie(secure) {
  let c = `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  if (secure) c += '; Secure';
  return c;
}
