/**
 * Constant-time admin-password verification.
 */
import crypto from 'node:crypto';

export function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  const len = Math.max(bufA.length, bufB.length, 1);
  const padA = Buffer.alloc(len);
  const padB = Buffer.alloc(len);
  bufA.copy(padA);
  bufB.copy(padB);
  const sameLen = bufA.length === bufB.length;
  return crypto.timingSafeEqual(padA, padB) && sameLen;
}

export function isAdminAuthorized(req) {
  const password = String(req?.headers?.['x-admin-password'] || '').trim();
  const expected = String(process.env.ADMIN_PASSWORD || '').trim();
  if (!expected) return false;
  return timingSafeEqualString(password, expected);
}
