import React from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CreditCard, LogIn, Settings, UserCircle } from 'lucide-react';
import BillingPage from './BillingPage';
import BeatSection from '../components/account/BeatSection.jsx';
import useAuth from '../hooks/useAuth';
import useSubscription from '../hooks/useSubscription';

export default function AccountPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, isLoading } = useAuth();
  const { status } = useSubscription();
  const activeTab = location.pathname.endsWith('/billing') ? 'billing' : 'profile';
  const returnUrl = encodeURIComponent(location.pathname + location.search);

  if (isLoading) {
    return (
      <div className="mapr-page account-page">
        <div className="account-loading">{t('auth.loading', 'Loading account…')}</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mapr-page account-auth-page">
        <section className="account-auth-gate">
          <UserCircle size={28} aria-hidden />
          <h1>{t('account.signInTitle', 'Sign in to manage your account')}</h1>
          <p>{t('account.signInBody', 'Create or access your MAPR account to manage billing, preferences, saved views, and alert settings.')}</p>
          <Link className="account-primary-link" to={`/login?returnUrl=${returnUrl}`}>
            <LogIn size={14} aria-hidden />
            {t('auth.signIn')}
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="mapr-page account-page">
      <aside className="account-sidebar" aria-label={t('account.navigation', 'Account navigation')}>
        <div className="account-user-card">
          <UserCircle size={22} aria-hidden />
          <div>
            <span>{t('account.signedInAs', 'Signed in as')}</span>
            <strong title={user.email}>{user.email}</strong>
          </div>
        </div>
        <nav className="account-nav">
          <NavLink to="/account" end className={({ isActive }) => `account-nav-link ${isActive ? 'is-active' : ''}`}>
            <UserCircle size={15} aria-hidden />
            <span>{t('account.profile', 'Profile')}</span>
          </NavLink>
          <NavLink to="/account/billing" className={({ isActive }) => `account-nav-link ${isActive ? 'is-active' : ''}`}>
            <CreditCard size={15} aria-hidden />
            <span>{t('account.billing', 'Billing')}</span>
          </NavLink>
        </nav>
      </aside>

      <main className="account-main">
        {activeTab === 'profile' ? (
          <>
            <header className="account-header">
              <p className="account-kicker">{t('account.profile', 'Profile')}</p>
              <h1>{t('account.title', 'Account')}</h1>
              <p>{t('account.subtitle', 'Manage your MAPR identity, workspace preferences, and subscription from one place.')}</p>
            </header>
            <section className="account-panel">
              <div className="account-panel-heading">
                <UserCircle size={16} aria-hidden />
                <h2>{t('account.identity', 'Identity')}</h2>
              </div>
              <dl className="account-detail-grid">
                <div>
                  <dt>{t('account.email', 'Email')}</dt>
                  <dd>{user.email}</dd>
                </div>
                <div>
                  <dt>{t('account.plan', 'Plan')}</dt>
                  <dd>{status.toUpperCase()}</dd>
                </div>
              </dl>
            </section>
            <section className="account-panel">
              <div className="account-panel-heading">
                <Settings size={16} aria-hidden />
                <h2>{t('account.preferences', 'Preferences')}</h2>
              </div>
              <p className="account-muted">
                {t('account.preferencesBody', 'Language, theme, saved views, alerts, and bookmarks are available from the app controls and account-linked side panels. Billing lives in the Billing tab.')}
              </p>
            </section>
            <section className="account-panel">
              <BeatSection />
            </section>
          </>
        ) : (
          <BillingPage embedded />
        )}
      </main>
    </div>
  );
}
