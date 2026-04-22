import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

describe('admin password gate', () => {
  describe('Layout sidebar exposes Admin NavLink', () => {
    const layout = readFileSync(resolve(ROOT, 'src/components/Layout.jsx'), 'utf8');

    it('contains a NavLink to /admin', () => {
      assert.ok(
        layout.includes('to="/admin"') || layout.includes("to='/admin'"),
        'Layout.jsx should contain NavLink to /admin',
      );
    });
  });

  describe('AdminPage has password gate', () => {
    const adminPage = readFileSync(resolve(ROOT, 'src/pages/AdminPage.jsx'), 'utf8');

    it('restores session via GET /api/admin/session with credentials', () => {
      assert.ok(
        adminPage.includes("'/api/admin/session'") && adminPage.includes("'include'"),
        'AdminPage should probe session cookie on load'
      );
    });

    it('renders a PasswordGate component when not authed', () => {
      assert.ok(adminPage.includes('PasswordGate'), 'AdminPage should render PasswordGate');
    });

    it('renders a password input field', () => {
      assert.ok(adminPage.includes('type="password"'), 'AdminPage should have a password input');
    });

    it('logs in with POST /api/admin/session and credentials', () => {
      assert.ok(
        adminPage.includes("'/api/admin/session'") && adminPage.includes("method: 'POST'"),
        'AdminPage should POST JSON password to /api/admin/session'
      );
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

  describe('Backend admin session routes', () => {
    const serverCode = readFileSync(resolve(ROOT, 'server/index.js'), 'utf8');

    it('has POST /api/admin/session', () => {
      assert.ok(
        serverCode.includes("request.method === 'POST' && url.pathname === '/api/admin/session'"),
        'server should expose POST /api/admin/session'
      );
    });

    it('has GET /api/admin/session for cookie probe', () => {
      assert.ok(
        serverCode.includes("request.method === 'GET' && url.pathname === '/api/admin/session'"),
        'GET session probe route'
      );
    });

    it('has POST /api/admin/logout', () => {
      assert.ok(serverCode.includes("'/api/admin/logout'"), 'logout route');
    });

    it('authorizes admin-health via adminAuthorized (cookie or header)', () => {
      assert.ok(serverCode.includes('adminAuthorized'), 'admin-health should use adminAuthorized');
    });

    it('returns 401 for wrong password on POST session', () => {
      const start = serverCode.indexOf("request.method === 'POST' && url.pathname === '/api/admin/session'");
      assert.ok(start >= 0);
      const block = serverCode.slice(start, start + 1400);
      assert.ok(block.includes('401'), 'invalid password → 401');
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
