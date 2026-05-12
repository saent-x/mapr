import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X, Bell, Loader2, Mail, Clock3 } from 'lucide-react';
import useAlertRules from '../hooks/useAlertRules';

const SEVERITY_TIERS = [
  { value: 85, key: 'critical' },
  { value: 60, key: 'elevated' },
  { value: 35, key: 'watch' },
  { value: 0, key: 'low' },
];

/**
 * Modal dialog for creating or editing an alert rule.
 *
 * Props:
 *   isOpen        — whether the dialog is visible
 *   onClose       — called when dialog closes (passes true if rule was saved)
 *   savedViews    — array of saved views to choose from
 *   editRule      — existing rule to edit (null for create)
 */
export default function AlertRuleDialog({ isOpen, onClose, savedViews = [], editRule = null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { needsAuth, createRule, editRule: updateRule } = useAlertRules();

  const [name, setName] = useState(editRule?.name || '');
  const [severityThreshold, setSeverityThreshold] = useState(editRule?.severityThreshold ?? 85);
  const [minConfidence, setMinConfidence] = useState(editRule?.minConfidence ?? 65);
  const [deliveryMode, setDeliveryMode] = useState(editRule?.deliveryMode || 'instant');
  const [emailEnabled, setEmailEnabled] = useState(Boolean(editRule?.channels?.email));
  const [digestEnabled, setDigestEnabled] = useState(Boolean(editRule?.channels?.digest));
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(Boolean(editRule?.quietHours?.enabled));
  const [savedViewId, setSavedViewId] = useState(editRule?.savedViewId || (savedViews[0]?.id || ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Re-sync local state when the dialog is reopened or the rule being edited
  // changes. Without this, the same dialog instance reused for edit-then-create
  // (or a different rule) keeps the previous values.
  useEffect(() => {
    if (!isOpen) return;
    setName(editRule?.name || '');
    setSeverityThreshold(editRule?.severityThreshold ?? 85);
    setMinConfidence(editRule?.minConfidence ?? 65);
    setDeliveryMode(editRule?.deliveryMode || 'instant');
    setEmailEnabled(Boolean(editRule?.channels?.email));
    setDigestEnabled(Boolean(editRule?.channels?.digest));
    setQuietHoursEnabled(Boolean(editRule?.quietHours?.enabled));
    setSavedViewId(editRule?.savedViewId || (savedViews[0]?.id || ''));
    setError('');
  }, [isOpen, editRule, savedViews]);

  const handleClose = (saved = false) => {
    // Reset to the canonical baseline (matches the create-fresh defaults).
    setName('');
    setSeverityThreshold(85);
    setMinConfidence(65);
    setDeliveryMode('instant');
    setEmailEnabled(false);
    setDigestEnabled(false);
    setQuietHoursEnabled(false);
    setSavedViewId(savedViews[0]?.id || '');
    setError('');
    onClose(saved);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (needsAuth) {
      const returnUrl = encodeURIComponent(location.pathname + location.search);
      navigate(`/login?returnUrl=${returnUrl}`);
      return;
    }
    if (!name.trim()) {
      setError(t('alertRules.nameRequired', 'Rule name is required'));
      return;
    }
    if (!savedViewId) {
      setError(t('alertRules.viewRequired', 'Select a saved view'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const premiumOptions = {
        minConfidence,
        deliveryMode,
        channels: { inApp: true, email: emailEnabled, digest: digestEnabled },
        quietHours: { enabled: quietHoursEnabled, start: '22:00', end: '07:00' },
      };
      if (editRule) {
        await updateRule(editRule.id, { name: name.trim(), severityThreshold, ...premiumOptions });
      } else {
        await createRule(name.trim(), severityThreshold, savedViewId, premiumOptions);
      }
      handleClose(true);
    } catch (err) {
      setError(err.message || t('alertRules.saveError', 'Failed to save alert rule'));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="save-view-overlay" onClick={() => handleClose(false)} role="dialog" aria-modal="true" aria-label={editRule ? t('alertRules.editTitle', 'Edit Alert Rule') : t('alertRules.createTitle', 'Create Alert Rule')}>
      <div className="save-view-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="save-view-header">
          <span className="save-view-title">
            <Bell size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} aria-hidden />
            {editRule ? t('alertRules.editTitle', 'Edit Alert Rule') : t('alertRules.createTitle', 'Create Alert Rule')}
          </span>
          <button
            type="button"
            className="save-view-close"
            onClick={() => handleClose(false)}
            aria-label={t('alertRules.close', 'Close')}
          >
            <X size={14} />
          </button>
        </div>

        <form className="save-view-form" onSubmit={handleSave}>
            <label className="save-view-label">
              {t('alertRules.ruleName', 'Rule Name')}
              <input
                className="save-view-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('alertRules.ruleNamePlaceholder', 'e.g. Critical Ukraine Alerts')}
                autoFocus
                maxLength={80}
              />
            </label>

            {!editRule && (
              <label className="save-view-label">
                {t('alertRules.savedView', 'Saved View')}
                <select
                  className="save-view-input"
                  value={savedViewId}
                  onChange={(e) => setSavedViewId(e.target.value)}
                  style={{ fontFamily: 'var(--ff-mono)' }}
                >
                  {savedViews.length === 0 && (
                    <option value="" disabled>{t('alertRules.noSavedViews', 'No saved views available')}</option>
                  )}
                  {savedViews.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </label>
            )}

            <label className="save-view-label">
              {t('alertRules.severityThreshold', 'Severity Threshold')}
              <select
                className="save-view-input"
                value={severityThreshold}
                onChange={(e) => setSeverityThreshold(Number(e.target.value))}
                style={{ fontFamily: 'var(--ff-mono)' }}
              >
                {SEVERITY_TIERS.map((tier) => (
                  <option key={tier.value} value={tier.value}>
                    {t(`legend.${tier.key}`, tier.key.toUpperCase())}
                  </option>
                ))}
              </select>
            </label>

            <label className="save-view-label">
              {t('alertRules.confidenceThreshold', 'Confidence floor')}
              <input
                className="save-view-input"
                type="range"
                min="0"
                max="95"
                step="5"
                value={minConfidence}
                onChange={(e) => setMinConfidence(Number(e.target.value))}
              />
              <span className="alert-rule-control-note">{minConfidence}% {t('alertRules.confidenceHint', 'minimum event confidence')}</span>
            </label>

            <label className="save-view-label">
              {t('alertRules.deliveryMode', 'Delivery mode')}
              <select
                className="save-view-input"
                value={deliveryMode}
                onChange={(e) => setDeliveryMode(e.target.value)}
                style={{ fontFamily: 'var(--ff-mono)' }}
              >
                <option value="instant">{t('alertRules.deliveryInstant', 'Instant signal')}</option>
                <option value="digest">{t('alertRules.deliveryDigest', 'Briefing digest')}</option>
                <option value="escalation">{t('alertRules.deliveryEscalation', 'Escalation only')}</option>
              </select>
            </label>

            <div className="alert-rule-premium-grid">
              <button
                type="button"
                className="alert-rule-option"
                data-active={emailEnabled ? 'true' : undefined}
                onClick={() => setEmailEnabled((value) => !value)}
                aria-pressed={emailEnabled}
              >
                <Mail size={12} aria-hidden />
                {t('alertRules.emailChannel', 'Email copy')}
              </button>
              <button
                type="button"
                className="alert-rule-option"
                data-active={digestEnabled ? 'true' : undefined}
                onClick={() => setDigestEnabled((value) => !value)}
                aria-pressed={digestEnabled}
              >
                <Bell size={12} aria-hidden />
                {t('alertRules.digestChannel', 'Add to digest')}
              </button>
              <button
                type="button"
                className="alert-rule-option"
                data-active={quietHoursEnabled ? 'true' : undefined}
                onClick={() => setQuietHoursEnabled((value) => !value)}
                aria-pressed={quietHoursEnabled}
              >
                <Clock3 size={12} aria-hidden />
                {t('alertRules.quietHours', 'Quiet hours')}
              </button>
            </div>

            {error && (
              <div className="save-view-error" role="alert" style={{ color: 'var(--sev-red)', fontSize: 'var(--fs-0)', fontFamily: 'var(--ff-mono)' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="save-view-submit"
              disabled={saving || savedViews.length === 0}
              style={{ opacity: saving ? 0.6 : 1 }}
            >
              {saving ? (
                <><Loader2 size={12} className="spin" /> {t('alertRules.saving', 'Saving…')}</>
              ) : (
                editRule ? t('alertRules.updateRule', 'Update Rule') : t('alertRules.createRule', 'Create Rule')
              )}
            </button>
          </form>
      </div>
    </div>
  );
}
