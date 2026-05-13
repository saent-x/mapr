import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, LogIn, UserCircle } from 'lucide-react';
import HistoricalQueriesPanel from '../components/HistoricalQueriesPanel';
import UpgradePrompt from '../components/UpgradePrompt';
import useAuth from '../hooks/useAuth';
import useSubscription from '../hooks/useSubscription';

/**
 * HistoricalQueriesPage — dedicated page for historical time-range queries,
 * date range selection, period comparison, and time travel.
 * Gated: requires Pro subscription.
 */
export default function HistoricalQueriesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading } = useAuth();
  const { hasFeatureAccess } = useSubscription();
  const canUseHistoricalQueries = hasFeatureAccess('historicalQueries');
  const returnUrl = encodeURIComponent(location.pathname + location.search);

  const handleClose = () => {
    navigate('/');
  };

  if (isLoading) {
    return (
      <div className="mapr-historical-page">
        <div className="mapr-historical-page-content mapr-historical-page-content--locked">
          <div className="account-loading">{t('auth.loading', 'Loading account…')}</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mapr-historical-page">
        <div className="mapr-historical-page-header">
          <button
            className="mapr-back-btn"
            onClick={() => navigate(-1)}
            type="button"
          >
            <ArrowLeft size={18} />
            <span>{t('nav.backToMap')}</span>
          </button>
          <div>
            <span className="mapr-historical-page-label">Archive</span>
            <h2 className="mapr-historical-page-title">{t('historicalQueries.title', 'Historical Queries')}</h2>
            <p className="mapr-historical-page-copy">Sign in to query earlier windows, compare periods, and recover historical signal.</p>
          </div>
        </div>
        <div className="mapr-historical-page-content mapr-historical-page-content--locked">
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
      </div>
    );
  }

  if (!canUseHistoricalQueries) {
    return (
      <div className="mapr-historical-page">
        <div className="mapr-historical-page-header">
          <button
            className="mapr-back-btn"
            onClick={() => navigate(-1)}
            type="button"
          >
            <ArrowLeft size={18} />
            <span>{t('nav.backToMap')}</span>
          </button>
          <div>
            <span className="mapr-historical-page-label">Archive</span>
            <h2 className="mapr-historical-page-title">{t('historicalQueries.title', 'Historical Queries')}</h2>
            <p className="mapr-historical-page-copy">Query earlier windows, compare periods, and recover historical signal.</p>
          </div>
        </div>
        <div className="mapr-historical-page-content mapr-historical-page-content--locked">
          <UpgradePrompt feature="historical" />
        </div>
      </div>
    );
  }

  return (
    <div className="mapr-historical-page">
      <div className="mapr-historical-page-header">
        <button
          className="mapr-back-btn"
          onClick={() => navigate(-1)}
          type="button"
          title={t('nav.backToMap')}
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <span className="mapr-historical-page-label">Archive</span>
          <h2 className="mapr-historical-page-title">{t('historicalQueries.pageTitle')}</h2>
          <p className="mapr-historical-page-copy">Run historical time-range queries and compare periods without leaving the console.</p>
        </div>
      </div>
      <div className="mapr-historical-page-content">
        <HistoricalQueriesPanel onClose={handleClose} />
      </div>
    </div>
  );
}
