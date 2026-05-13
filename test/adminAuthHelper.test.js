/**
 * Real test for the constant-time admin password compare.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqualString, isAdminAuthorized } from '../server/adminAuth.js';

describe('timingSafeEqualString', () => {
  it('returns true for identical strings', () => {
    assert.equal(timingSafeEqualString('hunter2', 'hunter2'), true);
  });

  it('returns false for differing strings of the same length', () => {
    assert.equal(timingSafeEqualString('hunter2', 'hunter3'), false);
  });

  it('returns false for strings of different length', () => {
    assert.equal(timingSafeEqualString('hunter2', 'hunter22'), false);
    assert.equal(timingSafeEqualString('', 'hunter2'), false);
  });

  it('handles null/undefined inputs without throwing', () => {
    assert.equal(timingSafeEqualString(null, 'x'), false);
    assert.equal(timingSafeEqualString(undefined, 'x'), false);
    assert.equal(timingSafeEqualString(null, null), true);
  });
});

describe('isAdminAuthorized', () => {
  it('rejects when ADMIN_PASSWORD is unset', () => {
    const prev = process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    try {
      assert.equal(isAdminAuthorized({ headers: { 'x-admin-password': 'whatever' } }), false);
    } finally {
      if (prev !== undefined) process.env.ADMIN_PASSWORD = prev;
    }
  });

  it('rejects wrong password', () => {
    const prev = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = 'correct-pw';
    try {
      assert.equal(isAdminAuthorized({ headers: { 'x-admin-password': 'wrong' } }), false);
    } finally {
      if (prev === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = prev;
    }
  });

  it('accepts correct password', () => {
    const prev = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = 'correct-pw';
    try {
      assert.equal(isAdminAuthorized({ headers: { 'x-admin-password': 'correct-pw' } }), true);
    } finally {
      if (prev === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = prev;
    }
  });

  it('handles missing headers object without throwing', () => {
    assert.equal(isAdminAuthorized({}), false);
    assert.equal(isAdminAuthorized(null), false);
  });
});
