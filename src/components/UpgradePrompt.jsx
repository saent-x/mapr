/**
 * UpgradePrompt — Displayed when Free users attempt to access Pro features.
 *
 * Shows a styled CTA with a description of the locked feature
 * and an "Upgrade to Pro" button that initiates Stripe Checkout.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Crown, Loader2, AlertTriangle } from 'lucide-react';
import useSubscription from '../hooks/useSubscription';

/**
 * @param {Object} props
 * @param {string} [props.feature] - Name of the locked feature (localized key)
 * @param {string} [props.description] - Optional description text
 */
export default function UpgradePrompt({ feature, description }) {
  const { t } = useTranslation();
  const { upgradeToPro, billingEnabled } = useSubscription();
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

  const featureLabel = feature ? t(`subscription.features.${feature}`, feature) : '';

  return (
    <div className="mapr-upgrade-prompt" role="alert">
      <div className="mapr-upgrade-prompt-icon">
        <Crown size={36} strokeWidth={1.5} />
      </div>
      <h3 className="mapr-upgrade-prompt-title">
        {t('subscription.proRequired')}
      </h3>
      {featureLabel && (
        <p className="mapr-upgrade-prompt-feature">
          {t('subscription.featureLocked', { feature: featureLabel })}
        </p>
      )}
      {description && (
        <p className="mapr-upgrade-prompt-desc">{description}</p>
      )}
      <p className="mapr-upgrade-prompt-body">
        {t('subscription.upgradeBody')}
      </p>
      <div className="mapr-upgrade-prompt-benefits">
        <span className="mapr-upgrade-prompt-benefit">{t('subscription.benefits.alerts')}</span>
        <span className="mapr-upgrade-prompt-benefit">{t('subscription.benefits.export')}</span>
        <span className="mapr-upgrade-prompt-benefit">{t('subscription.benefits.historical')}</span>
        <span className="mapr-upgrade-prompt-benefit">{t('subscription.benefits.advancedFilters')}</span>
      </div>
      <button
        className="mapr-upgrade-prompt-btn"
        onClick={handleUpgrade}
        disabled={loading || !billingEnabled}
        aria-label={t('subscription.upgradeToPro')}
      >
        {loading ? (
          <Loader2 size={18} className="mapr-spin" />
        ) : (
          <Crown size={18} />
        )}
        <span>{loading ? t('subscription.redirecting') : t('subscription.upgradeToPro')}</span>
      </button>
      {!billingEnabled && (
        <p className="mapr-upgrade-prompt-error" role="status">
          <AlertTriangle size={14} />
          {t('subscription.billingDisabled', 'Subscription upgrades are currently disabled.')}
        </p>
      )}
      {error && (
        <p className="mapr-upgrade-prompt-error" role="alert">
          <AlertTriangle size={14} />
          {error}
        </p>
      )}
    </div>
  );
}
