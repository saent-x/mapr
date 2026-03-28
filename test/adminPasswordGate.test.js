import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

describe('admin password gate', () => {
  describe('Layout sidebar has no Admin NavLink', () => {
    const layout = readFileSync(resolve(ROOT, 'src/components/Layout.jsx'), 'utf8');

    it('does not contain a NavLink to /admin', () => {
      assert.ok(!layout.includes('to="/admin"'), 'Layout.jsx should not contain NavLink to /admin');
    });

    it('does not import Shield icon (admin icon removed)', () => {
      assert.ok(!layout.includes('Shield'), 'Layout.jsx should not import Shield icon');
    });
  });

  describe('AdminPage has password gate', () => {
    const adminPage = readFileSync(resolve(ROOT, 'src/pages/AdminPage.jsx'), 'utf8');

    it('uses sessionStorage for auth persistence', () => {
      assert.ok(adminPage.includes('sessionStorage'), 'AdminPage should use sessionStorage');
    });

    it('has a SESSION_KEY constant', () => {
      assert.ok(adminPage.includes('SESSION_KEY'), 'AdminPage should define SESSION_KEY');
    });

    it('renders a PasswordGate component when not authed', () => {
      assert.ok(adminPage.includes('PasswordGate'), 'AdminPage should render PasswordGate');
    });

    it('renders a password input field', () => {
      assert.ok(adminPage.includes('type="password"'), 'AdminPage should have a password input');
    });

    it('calls /api/admin/verify endpoint', () => {
      assert.ok(adminPage.includes('/api/admin/verify'), 'AdminPage should call /api/admin/verify');
    });

    it('shows error message on wrong password', () => {
      assert.ok(adminPage.includes("t('admin.wrongPassword')"), 'AdminPage should show wrong password error');
    });

    it('uses i18n keys for all password gate strings', () => {
      assert.ok(adminPage.includes("t('admin.passwordRequired')"), 'should use admin.passwordRequired key');
      assert.ok(adminPage.includes("t('admin.enterPassword')"), 'should use admin.enterPassword key');
      assert.ok(adminPage.includes("t('admin.submit')"), 'should use admin.submit key');
    });
  });

  describe('Backend verify endpoint', () => {
    const serverCode = readFileSync(resolve(ROOT, 'server/index.js'), 'utf8');

    it('has GET /api/admin/verify route', () => {
      assert.ok(serverCode.includes("'/api/admin/verify'"), 'server should have /api/admin/verify route');
    });

    it('reads password from query parameter', () => {
      assert.ok(serverCode.includes("url.searchParams.get('password')"), 'should read password from query params');
    });

    it('defaults to admin when ADMIN_PASSWORD is not set', () => {
      assert.ok(
        serverCode.includes("process.env.ADMIN_PASSWORD || 'admin'"),
        'should default to admin password'
      );
    });

    it('returns 200 for correct password', () => {
      // Check that the route sends a 200 JSON response on match
      const verifyBlock = serverCode.slice(
        serverCode.indexOf("'/api/admin/verify'"),
        serverCode.indexOf("'/api/admin/verify'") + 500
      );
      assert.ok(verifyBlock.includes('200'), 'should return 200 for correct password');
    });

    it('returns 401 for wrong password', () => {
      const verifyBlock = serverCode.slice(
        serverCode.indexOf("'/api/admin/verify'"),
        serverCode.indexOf("'/api/admin/verify'") + 500
      );
      assert.ok(verifyBlock.includes('401'), 'should return 401 for wrong password');
    });
  });

  describe('i18n keys', () => {
    const en = JSON.parse(readFileSync(resolve(ROOT, 'src/i18n/locales/en.json'), 'utf8'));

    it('has admin.passwordRequired key', () => {
      assert.ok(en.admin.passwordRequired, 'en.json should have admin.passwordRequired');
    });

    it('has admin.enterPassword key', () => {
      assert.ok(en.admin.enterPassword, 'en.json should have admin.enterPassword');
    });

    it('has admin.submit key', () => {
      assert.ok(en.admin.submit, 'en.json should have admin.submit');
    });

    it('has admin.wrongPassword key', () => {
      assert.ok(en.admin.wrongPassword, 'en.json should have admin.wrongPassword');
    });
  });

  describe('.env.example', () => {
    const envExample = readFileSync(resolve(ROOT, '.env.example'), 'utf8');

    it('contains ADMIN_PASSWORD variable', () => {
      assert.ok(envExample.includes('ADMIN_PASSWORD'), '.env.example should contain ADMIN_PASSWORD');
    });
  });
});
