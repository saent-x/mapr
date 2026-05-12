import { lookup } from '@instantdb/react';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getUserOwnerRef(user) {
  if (user?.id && UUID_RE.test(user.id)) return user.id;
  if (user?.email) return lookup('email', user.email);
  throw new Error('Authenticated user must have an email address to create user-owned records');
}

export function getUserOwnerWhere(user) {
  if (user?.id && UUID_RE.test(user.id)) return { owner: user.id };
  if (user?.email) return { 'owner.email': user.email };
  return { id: '__no_user_owner__' };
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}
