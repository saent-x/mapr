/**
 * BillingPage — Subscription management and pricing display.
 *
 * Shows:
 *   - Free tier (current for free users)
 *   - Pro tier with upgrade button
 *   - Enterprise tier (toggle OFF by default, coming soon)
 *   - Current plan indicator
 *   - Manage Subscription button for Pro users
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Crown, Check, Zap, Loader2, Building2, AlertTriangle } from 'lucide-react';
import useSubscription from '../hooks/useSubscription';

export default function BillingPage({ embedded = false }) {
  const { t } = useTranslation();
  const {
    status, isLoading, isFree, isPro, isEnterprise,
    upgradeToPro, manageSubscription,
  } = useSubscription();
  const [enterpriseOn, setEnterpriseOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleUpgrade = async () => {
    setLoading(true);
    setError(null);
    try {
      await upgradeToPro();
    } catch (err) {
      setError(err.message || t('subscription.upgradeError'));
      setLoading(false);
    }
  };

  const handleManage = async () => {
    setLoading(true);
    setError(null);
    try {
      await manageSubscription();
    } catch (err) {
      setError(err.message || t('subscription.portalError'));
      setLoading(false);
    }
  };

  const handleEnterpriseToggle = () => {
    setEnterpriseOn(!enterpriseOn);
  };

  if (isLoading) {
    return (
      <div className={embedded ? "mapr-billing-embed" : "mapr-page"}>
        <div className="mapr-billing-loading">
          <Loader2 size={24} className="mapr-spin" />
          <span>{t('subscription.loading')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "mapr-billing-embed" : "mapr-page"}>
      <div className="mapr-billing">
        <h1 className="mapr-billing-title">{t('subscription.title')}</h1>
        <p className="mapr-billing-subtitle">{t('subscription.subtitle')}</p>

        {status === 'pro' && (
          <div className="mapr-billing-current">
            <Crown size={18} />
            <span>{t('subscription.currentPlan', { plan: 'Pro' })}</span>
          </div>
        )}

        <div className="mapr-billing-tiers">
          {/* Free Tier */}
          <div className={`mapr-billing-tier ${isFree ? 'mapr-billing-tier--current' : ''}`}>
            <div className="mapr-billing-tier-header">
              <h2 className="mapr-billing-tier-name">{t('subscription.tiers.free.name')}</h2>
              <span className="mapr-billing-tier-price">{t('subscription.tiers.free.price')}</span>
            </div>
            <p className="mapr-billing-tier-desc">{t('subscription.tiers.free.desc')}</p>
            <ul className="mapr-billing-tier-features">
              <li><Check size={14} />{t('subscription.tiers.free.feature1')}</li>
              <li><Check size={14} />{t('subscription.tiers.free.feature2')}</li>
              <li><Check size={14} />{t('subscription.tiers.free.feature3')}</li>
            </ul>
            {isFree && (
              <div className="mapr-billing-tier-badge">{t('subscription.current')}</div>
            )}
          </div>

          {/* Pro Tier */}
          <div className={`mapr-billing-tier mapr-billing-tier--pro ${isPro ? 'mapr-billing-tier--current' : ''}`}>
            <div className="mapr-billing-tier-header">
              <h2 className="mapr-billing-tier-name">
                <Crown size={16} />
                {t('subscription.tiers.pro.name')}
              </h2>
              <span className="mapr-billing-tier-price">{t('subscription.tiers.pro.price')}</span>
            </div>
            <p className="mapr-billing-tier-desc">{t('subscription.tiers.pro.desc')}</p>
            <ul className="mapr-billing-tier-features">
              <li><Check size={14} />{t('subscription.tiers.pro.feature1')}</li>
              <li><Check size={14} />{t('subscription.tiers.pro.feature2')}</li>
              <li><Check size={14} />{t('subscription.tiers.pro.feature3')}</li>
              <li><Check size={14} />{t('subscription.tiers.pro.feature4')}</li>
              <li><Check size={14} />{t('subscription.tiers.pro.feature5')}</li>
            </ul>
            {isPro ? (
              <button className="mapr-billing-tier-btn mapr-billing-tier-btn--manage" onClick={handleManage} disabled={loading}>
                {loading ? <Loader2 size={16} className="mapr-spin" /> : <Building2 size={16} />}
                <span>{loading ? t('subscription.loading') : t('subscription.manageSubscription')}</span>
              </button>
            ) : isFree ? (
              <button className="mapr-billing-tier-btn" onClick={handleUpgrade} disabled={loading}>
                {loading ? <Loader2 size={16} className="mapr-spin" /> : <Zap size={16} />}
                <span>{loading ? t('subscription.redirecting') : t('subscription.upgradeToPro')}</span>
              </button>
            ) : null}
          </div>

          {/* Enterprise Tier */}
          <div className={`mapr-billing-tier mapr-billing-tier--enterprise ${isEnterprise ? 'mapr-billing-tier--current' : ''}`}>
            <div className="mapr-billing-tier-header">
              <h2 className="mapr-billing-tier-name">
                <Building2 size={16} />
                {t('subscription.tiers.enterprise.name')}
              </h2>
              <span className="mapr-billing-tier-price">{t('subscription.tiers.enterprise.price')}</span>
            </div>
            <p className="mapr-billing-tier-desc">{t('subscription.tiers.enterprise.desc')}</p>
            <ul className="mapr-billing-tier-features">
              <li><Check size={14} />{t('subscription.tiers.enterprise.feature1')}</li>
              <li><Check size={14} />{t('subscription.tiers.enterprise.feature2')}</li>
              <li><Check size={14} />{t('subscription.tiers.enterprise.feature3')}</li>
            </ul>
            <label className="mapr-billing-tier-toggle">
              <input
                type="checkbox"
                checked={enterpriseOn}
                onChange={handleEnterpriseToggle}
                aria-label={t('subscription.tiers.enterprise.toggleLabel')}
              />
              <span className="mapr-billing-tier-toggle-label">
                {enterpriseOn ? t('subscription.tiers.enterprise.comingSoon') : t('subscription.tiers.enterprise.comingSoon')}
              </span>
            </label>
          </div>
        </div>

        {error && (
          <p className="mapr-billing-error" role="alert">
            <AlertTriangle size={14} />
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
