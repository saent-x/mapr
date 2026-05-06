import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Bell, Loader2, LogIn } from 'lucide-react';
import { SignedIn, SignedOut } from './auth';
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
  const { needsAuth, createRule, editRule: updateRule } = useAlertRules();

  const [name, setName] = useState(editRule?.name || '');
  const [severityThreshold, setSeverityThreshold] = useState(editRule?.severityThreshold ?? 85);
  const [savedViewId, setSavedViewId] = useState(editRule?.savedViewId || (savedViews[0]?.id || ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleClose = (saved = false) => {
    setName('');
    setSeverityThreshold(70);
    setSavedViewId(savedViews[0]?.id || '');
    setError('');
    onClose(saved);
  };

  const handleSave = async (e) => {
    e.preventDefault();
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
      if (editRule) {
        await updateRule(editRule.id, { name: name.trim(), severityThreshold });
      } else {
        await createRule(name.trim(), severityThreshold, savedViewId);
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

        <SignedIn>
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
        </SignedIn>

        <SignedOut>
          {needsAuth && (
            <div className="save-view-login-prompt">
              <LogIn size={20} aria-hidden />
              <p>{t('alertRules.signInPrompt', 'Sign in to create alert rules')}</p>
            </div>
          )}
        </SignedOut>
      </div>
    </div>
  );
}
