/**
 * Server-side authentication helpers for InstantDB-issued tokens.
 *
 * Clients send the InstantDB refresh token via:
 *   `Authorization: Bearer <token>`
 *
 * We verify the token with the InstantDB admin SDK and return the
 * authenticated user. Requests without a valid token are rejected with 401.
 */

import { init } from '@instantdb/admin';

const INSTANT_APP_ID = process.env.INSTANT_APP_ID || '';
const INSTANT_ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN || '';

let _db = null;
function getDb() {
  if (!_db) {
    if (!INSTANT_APP_ID || !INSTANT_ADMIN_TOKEN) {
      throw Object.assign(new Error('InstantDB auth not configured'), {
        code: 'AUTH_NOT_CONFIGURED',
        statusCode: 503,
      });
    }
    _db = init({ appId: INSTANT_APP_ID, adminToken: INSTANT_ADMIN_TOKEN });
  }
  return _db;
}

function extractBearer(request) {
  const header = request.headers?.authorization || request.headers?.Authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  return match ? match[1].trim() : null;
}

/**
 * Verify the bearer token on a request and return the InstantDB user.
 * Throws an Error with statusCode 401/503 on failure.
 */
export async function requireUser(request) {
  const token = extractBearer(request);
  if (!token) {
    throw Object.assign(new Error('Missing Authorization header'), {
      code: 'UNAUTHORIZED',
      statusCode: 401,
    });
  }
  const db = getDb();
  let user;
  try {
    user = await db.auth.verifyToken(token);
  } catch (err) {
    throw Object.assign(new Error('Invalid token'), {
      code: 'UNAUTHORIZED',
      statusCode: 401,
    });
  }
  if (!user || !user.id) {
    throw Object.assign(new Error('Invalid token'), {
      code: 'UNAUTHORIZED',
      statusCode: 401,
    });
  }
  return user;
}

/**
 * Look up the requesting user's full $users record (including stripeCustomerId
 * and subscriptionStatus). Used by paywall enforcement and the billing portal.
 */
export async function getRequestUserRecord(request) {
  const authedUser = await requireUser(request);
  const db = getDb();
  const result = await db.query({
    $users: { $: { where: { id: authedUser.id } } },
  });
  const record = result?.$users?.[0] || null;
  return { authedUser, record };
}
