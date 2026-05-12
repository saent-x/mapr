/**
 * Auth Tests — VAL-M1-004 through VAL-M1-013
 *
 * Covers:
 *   VAL-M1-004: InstantDB packages installed
 *   VAL-M1-005: SignedIn/SignedOut components exist
 *   VAL-M1-013: User profile entity created on first sign-in
 *
 * Browser-based assertions (VAL-M1-006 through VAL-M1-012)
 * are verified by agent-browser validators.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'src');

function read(p) {
  return readFileSync(path.join(root, p), 'utf-8');
}

// ═══════════════════════════════════════════
// VAL-M1-004: InstantDB packages installed
// ═══════════════════════════════════════════

test('VAL-M1-004: @instantdb/react in package.json dependencies', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies, 'package.json must have dependencies');
  assert.ok(
    '@instantdb/react' in pkg.dependencies,
    '@instantdb/react must be in dependencies, not devDependencies',
  );
  assert.ok(
    '@instantdb/admin' in pkg.dependencies,
    '@instantdb/admin must be in dependencies, not devDependencies',
  );
});

// ═══════════════════════════════════════════
// VAL-M1-005: SignedIn/SignedOut components
// ═══════════════════════════════════════════

test('VAL-M1-005: SignedIn component file exists', () => {
  const f = path.join(SRC, 'components', 'auth', 'SignedIn.jsx');
  assert.ok(existsSync(f), 'SignedIn.jsx must exist');
  const content = readFileSync(f, 'utf-8');
  assert.ok(content.includes('export default function SignedIn'),
    'SignedIn must export a default function component');
  assert.ok(content.includes('db.useAuth'),
    'SignedIn must use InstantDB useAuth hook');
  assert.ok(content.includes('children'),
    'SignedIn must render children');
});

test('VAL-M1-005: SignedOut component file exists', () => {
  const f = path.join(SRC, 'components', 'auth', 'SignedOut.jsx');
  assert.ok(existsSync(f), 'SignedOut.jsx must exist');
  const content = readFileSync(f, 'utf-8');
  assert.ok(content.includes('export default function SignedOut'),
    'SignedOut must export a default function component');
  assert.ok(content.includes('db.useAuth'),
    'SignedOut must use InstantDB useAuth hook');
  assert.ok(content.includes('children'),
    'SignedOut must render children');
});

test('VAL-M1-005: auth/index.js barrel exports both components', () => {
  const f = path.join(SRC, 'components', 'auth', 'index.js');
  assert.ok(existsSync(f), 'auth/index.js must exist');
  const content = readFileSync(f, 'utf-8');
  assert.ok(content.includes('SignedIn'), 'index.js must export SignedIn');
  assert.ok(content.includes('SignedOut'), 'index.js must export SignedOut');
});

// ═══════════════════════════════════════════
// VAL-M1-013: User profile on first sign-in
// ═══════════════════════════════════════════

test('VAL-M1-013: authUtils module exists', () => {
  const f = path.join(SRC, 'utils', 'authUtils.js');
  assert.ok(existsSync(f), 'authUtils.js must exist');
});

test('VAL-M1-013: isFirstSignIn detects new user creation', async () => {
  const { isFirstSignIn } = await import('../src/utils/authUtils.js');

  assert.equal(isFirstSignIn({ created: true, user: { id: 'u1' } }), true,
    'should return true when created flag is set');

  assert.equal(isFirstSignIn({ created: false }), false,
    'should return false when created flag is false');

  assert.equal(isFirstSignIn({}), false,
    'should return false when no created flag');

  assert.equal(isFirstSignIn(null), false,
    'should return false for null');

  assert.equal(isFirstSignIn(undefined), false,
    'should return false for undefined');
});

test('VAL-M1-013: buildProfileCreationTxn produces correct profile shape', async () => {
  const { buildProfileCreationTxn } = await import('../src/utils/authUtils.js');

  const before = Date.now();
  const profile = buildProfileCreationTxn('user-abc-123', 'agent@mapr.io');
  const after = Date.now();

  assert.equal(profile.userId, 'user-abc-123',
    'profile must contain the user ID');
  assert.equal(profile.email, 'agent@mapr.io',
    'profile must contain the email');
  assert.equal(profile.displayName, 'agent',
    'displayName must be the email prefix');
  assert.ok(typeof profile.createdAt === 'number',
    'createdAt must be a timestamp number');
  assert.ok(profile.createdAt >= before && profile.createdAt <= after,
    'createdAt must be within current time window');
});

test('VAL-M1-013: createProfileOps generates transaction operations', async () => {
  const { createProfileOps } = await import('../src/utils/authUtils.js');

  // Mock tx object similar to InstantDB shape
  const mockTx = {
    profiles: {
      lookup: (attr, value) => ({
        update: (data) => ({
          __op: 'update',
          entity: 'profiles',
          lookup: { attr, value },
          data,
        }),
      }),
    },
  };

  const ops = createProfileOps(mockTx, 'hai-user-1', 'test@mapr.io');

  assert.ok(Array.isArray(ops), 'should return an array of operations');
  assert.equal(ops.length, 1, 'should return exactly one operation');

  const op = ops[0];
  assert.equal(op.__op, 'update', 'operation should be an update');
  assert.equal(op.entity, 'profiles', 'operation should target profiles entity');
  assert.deepEqual(op.lookup, { attr: 'uid', value: 'hai-user-1' },
    'operation should use uid lookup instead of a non-UUID tx path');

  const data = op.data;
  assert.equal(data.email, 'test@mapr.io', 'data must have email');
  assert.equal(data.displayName, 'test', 'data must have displayName');
  assert.equal(data.uid, 'hai-user-1', 'data must have uid');
  assert.ok(typeof data.createdAt === 'number', 'data must have createdAt timestamp');
});

test('VAL-M1-013: user-owned writes avoid non-UUID auth IDs', async () => {
  const { isUuid } = await import('../src/utils/instantUser.js');

  assert.equal(isUuid('hai-1778260218878'), false,
    'human auth IDs should not be used as InstantDB entity IDs');
  assert.equal(isUuid('550e8400-e29b-41d4-a716-446655440000'), true,
    'valid UUIDs remain valid entity IDs');
});

test('user-owned writes prefer UUID auth IDs over email lookups', async () => {
  const { getUserOwnerRef, getUserOwnerWhere } = await import('../src/utils/instantUser.js');

  const user = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    email: 'analyst@mapr.test',
  };

  assert.equal(getUserOwnerRef(user), user.id,
    'owner links should use the existing $users UUID instead of an email lookup when available');
  assert.deepEqual(getUserOwnerWhere(user), { owner: user.id },
    'owner queries should use the same UUID owner path as writes');
});

test('VAL-M1-013: second sign-in does not overwrite profile', async () => {
  const { buildProfileCreationTxn, isFirstSignIn } = await import('../src/utils/authUtils.js');

  // Simulate first sign-in
  const firstProfile = buildProfileCreationTxn('user-x', 'returning@mapr.io');
  assert.ok(firstProfile.createdAt > 0, 'first sign-in must set createdAt');

  // Simulate second sign-in — should NOT call buildProfileCreationTxn again
  const secondResult = { created: false, user: { id: 'user-x' } };
  assert.equal(isFirstSignIn(secondResult), false,
    'second sign-in should NOT trigger profile creation');

  // The guarding logic: isFirstSignIn returns false, so profile creation
  // is skipped entirely. The original createdAt is preserved.
});

// ═══════════════════════════════════════════
// Additional: Files and structure checks
// ═══════════════════════════════════════════

test('instant.schema.ts exists', () => {
  const f = path.join(root, 'instant.schema.ts');
  assert.ok(existsSync(f), 'instant.schema.ts must exist');
  const content = readFileSync(f, 'utf-8');
  assert.ok(content.includes('$users'), 'schema must define $users entity');
  assert.ok(content.includes('profiles'), 'schema must define profiles entity');
  assert.ok(content.includes('savedViews'), 'schema must define savedViews entity');
  assert.ok(content.includes('alertRules'), 'schema must define alertRules entity');
  assert.ok(content.includes('bookmarks'), 'schema must define bookmarks entity');
  assert.ok(content.includes('subscriptions'), 'schema must define subscriptions entity');
});

test('useAuth hook file exists', () => {
  const f = path.join(SRC, 'hooks', 'useAuth.js');
  assert.ok(existsSync(f), 'useAuth.js must exist');
  const content = readFileSync(f, 'utf-8');
  assert.ok(content.includes('export default function useAuth'),
    'useAuth must export a default function');
  assert.ok(content.includes('sendMagicCode'), 'useAuth must expose sendMagicCode');
  assert.ok(content.includes('signInWithCode'), 'useAuth must expose signInWithCode');
  assert.ok(content.includes('signOut'), 'useAuth must expose signOut');
});

test('instantDb service file exists', () => {
  const f = path.join(SRC, 'services', 'instantDb.js');
  assert.ok(existsSync(f), 'instantDb.js must exist');
  const content = readFileSync(f, 'utf-8');
  assert.ok(content.includes("from '@instantdb/react'"),
    'instantDb must import from @instantdb/react');
  assert.ok(content.includes('export const db'),
    'instantDb must export db client');
});

test('LoginPage component file exists', () => {
  const f = path.join(SRC, 'pages', 'LoginPage.jsx');
  assert.ok(existsSync(f), 'LoginPage.jsx must exist');
  const content = readFileSync(f, 'utf-8');
  assert.ok(content.includes('sendMagicCode'),
    'LoginPage must use sendMagicCode');
  assert.ok(content.includes('signInWithMagicCode'),
    'LoginPage must use signInWithMagicCode');
  assert.ok(content.includes('isFirstSignIn'),
    'LoginPage must check for first sign-in');
  assert.ok(content.includes('returnUrl'),
    'LoginPage must handle return URL redirect');
});

test('LoginPage exposes a sign-up mode and cross-links sign-in/sign-up', () => {
  const content = read('src/pages/LoginPage.jsx');
  assert.ok(content.includes("location.pathname === '/signup'"),
    'LoginPage must detect /signup mode');
  assert.ok(content.includes("t('auth.signupTitle')"),
    'LoginPage must render sign-up title copy');
  assert.ok(content.includes("t('auth.signUp')"),
    'LoginPage must link sign-in users to sign up');
  assert.ok(content.includes("to={alternateTo}"),
    'LoginPage must preserve returnUrl when switching auth modes');
});

test('Header includes auth UI elements', () => {
  const f = path.join(SRC, 'components', 'Header.jsx');
  assert.ok(existsSync(f), 'Header.jsx must exist');
  const content = readFileSync(f, 'utf-8');
  assert.ok(content.includes("db.useAuth"),
    'Header must use InstantDB useAuth');
  assert.ok(content.includes('header-user-menu'),
    'Header must have user menu container');
  assert.ok(content.includes('header-signout-btn'),
    'Header must have sign-out button');
  assert.ok(content.includes('header-signin-link'),
    'Header must have sign-in link');
});

test('Header uses a right-side profile avatar menu for signed-in users', () => {
  const header = readFileSync(path.join(SRC, 'components', 'Header.jsx'), 'utf-8');
  const css = readFileSync(path.join(SRC, 'index.css'), 'utf-8');
  assert.match(header, /header-profile-trigger/, 'Signed-in header should use an avatar trigger');
  assert.match(header, /header-profile-menu/, 'Signed-in header should expose an account menu');
  assert.match(header, /to="\/account"/, 'Profile menu should link to account');
  assert.match(header, /to="\/account\/billing"/, 'Profile menu should link to billing');
  assert.doesNotMatch(header, /className="header-account-link"[\s\S]*?\{user\.email\}/, 'Header should not place raw email as the primary navbar item');
  assert.match(css, /\.header-profile-avatar/, 'Profile avatar should be styled as a circular control');
  assert.match(css, /\.header-user-menu:hover \.header-profile-menu/, 'Profile menu should open on hover');
});

test('main.jsx has login route', () => {
  const content = read('src/main.jsx');
  assert.ok(content.includes('/login'), 'main.jsx must define /login route');
  assert.ok(content.includes('/signup'), 'main.jsx must define /signup route');
  assert.ok(content.includes('LoginPage'), 'main.jsx must import LoginPage');
});

test('CSP allows InstantDB connections', () => {
  const content = read('index.html');
  assert.ok(content.includes('connect-src'),
    'index.html must have connect-src CSP directive');
  assert.ok(content.includes('*.instantdb.com'),
    'connect-src must allow *.instantdb.com');
});

test('All public routes defined in main.jsx', () => {
  const content = read('src/main.jsx');
  // All public routes listed in expected behavior
  const routes = ['/', '/region/:iso', '/entities', '/trends', '/intel', '/health'];
  for (const route of routes) {
    assert.ok(content.includes(`path="${route}"`) || content.includes(`path="${route}/"`),
      `main.jsx must have route: ${route}`);
  }
});

test('Auth i18n keys present in all 5 locale files', () => {
  const locales = ['en', 'es', 'fr', 'ar', 'zh'];
  const requiredKeys = [
    'signIn', 'signOut', 'sendCode', 'verifyCode',
    'codeLabel', 'emailLabel', 'loginTitle', 'loginFooter',
    'signInPrompt', 'backToEmail', 'signUp', 'signupTitle',
    'signupSubtitle', 'signupFooter', 'noAccount', 'hasAccount',
  ];

  for (const lang of locales) {
    const content = read(`src/i18n/locales/${lang}.json`);
    const parsed = JSON.parse(content);
    assert.ok(parsed.auth, `${lang}.json must have "auth" section`);

    for (const key of requiredKeys) {
      assert.ok(parsed.auth[key],
        `${lang}.json auth.${key} must have a value`);
      assert.ok(parsed.auth[key].length > 0,
        `${lang}.json auth.${key} must not be empty`);
    }
  }
});
