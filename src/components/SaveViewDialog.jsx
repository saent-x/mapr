import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2, LogIn, Pin } from 'lucide-react';
import db from '../services/instantDb';
import useSavedViews from '../hooks/useSavedViews';
import UpgradePrompt from './UpgradePrompt';
import useSubscription from '../hooks/useSubscription';

/**
 * Modal dialog for naming and saving the current filter + map state as a saved view.
 * Auth-gated: shows login prompt if unauthenticated.
 *
 * Props:
 *   isOpen        - whether the dialog is visible
 *   onClose       - called to dismiss
 *   filterState   - current filter store state to save
 *   mapState      - current map state to save
 */
export default function SaveViewDialog({ isOpen, onClose, filterState, mapState }) {
  const { t } = useTranslation();
  const { user, isLoading: authLoading } = db.useAuth();
  const { saveView } = useSavedViews([]);
  const { hasFeatureAccess } = useSubscription();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen && user && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, user]);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!isOpen) {
      setName('');
      setDescription('');
      setTagsInput('');
      setPinned(false);
      setError('');
      setSaving(false);
    }
  }, [isOpen]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim() || !user) return;

    setSaving(true);
    setError('');

    try {
      const tags = tagsInput
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 6);
      await saveView(name.trim(), filterState, mapState, {
        description: description.trim(),
        tags,
        pinned,
      });
      onClose(true); // true = saved successfully
    } catch (err) {
      setError(err?.message || t('savedViews.saveError', 'Failed to save view'));
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose(false);
    }
  };

  if (!isOpen) return null;

  if (!hasFeatureAccess('savedViews')) {
    return (
      <div
        className="save-view-overlay"
        onClick={() => onClose(false)}
        role="dialog"
        aria-modal="true"
        aria-label={t('subscription.proRequired', 'Pro Subscription Required')}
      >
        <div className="save-view-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="save-view-header">
            <h2 className="save-view-title">{t('subscription.proRequired', 'Pro Subscription Required')}</h2>
            <button
              type="button"
              className="save-view-close"
              onClick={() => onClose(false)}
              aria-label={t('savedViews.cancel')}
            >
              <X size={16} />
            </button>
          </div>
          <UpgradePrompt feature="savedViews" />
        </div>
      </div>
    );
  }

  const isAuthenticated = !!user && !authLoading;
  const showLoginPrompt = !authLoading && !user;

  return (
    <div
      className="save-view-overlay"
      onClick={() => onClose(false)}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label={t('savedViews.saveDialogTitle')}
    >
      <div className="save-view-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="save-view-header">
          <h2 className="save-view-title">{t('savedViews.saveDialogTitle')}</h2>
          <button
            type="button"
            className="save-view-close"
            onClick={() => onClose(false)}
            aria-label={t('savedViews.cancel')}
          >
            <X size={16} />
          </button>
        </div>

        {showLoginPrompt && (
          <div className="save-view-login-prompt">
            <LogIn size={16} aria-hidden />
            <p>{t('savedViews.loginToSave', 'Sign in to save your current filter view')}</p>
          </div>
        )}

        {isAuthenticated && (
          <form className="save-view-form" onSubmit={handleSave}>
            <label className="save-view-label" htmlFor="save-view-name">
              {t('savedViews.nameLabel')}
            </label>
            <input
              ref={inputRef}
              id="save-view-name"
              className="save-view-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('savedViews.namePlaceholder')}
              maxLength={80}
              disabled={saving}
              aria-label={t('savedViews.nameLabel')}
              data-testid="save-view-name-input"
            />
            <label className="save-view-label" htmlFor="save-view-description">
              {t('savedViews.descriptionLabel', 'Analyst note')}
            </label>
            <textarea
              id="save-view-description"
              className="save-view-input save-view-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('savedViews.descriptionPlaceholder', 'What decision or beat is this view tracking?')}
              maxLength={220}
              disabled={saving}
            />
            <label className="save-view-label" htmlFor="save-view-tags">
              {t('savedViews.tagsLabel', 'Tags')}
            </label>
            <input
              id="save-view-tags"
              className="save-view-input"
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder={t('savedViews.tagsPlaceholder', 'sahel, election, supply-chain')}
              maxLength={120}
              disabled={saving}
            />
            <button
              type="button"
              className="save-view-pin-toggle"
              data-active={pinned ? 'true' : undefined}
              onClick={() => setPinned((value) => !value)}
              aria-pressed={pinned}
            >
              <Pin size={12} aria-hidden />
              {t('savedViews.pinToTop', 'Pin to top')}
            </button>
            {error && (
              <div className="save-view-error" role="alert">
                {error}
              </div>
            )}
            <p className="save-view-hint">{t('savedViews.hint')}</p>
            <div className="save-view-actions">
              <button
                type="button"
                className="save-view-btn save-view-btn-cancel"
                onClick={() => onClose(false)}
                disabled={saving}
              >
                {t('savedViews.cancel')}
              </button>
              <button
                type="submit"
                className="save-view-btn save-view-btn-save"
                disabled={saving || !name.trim()}
                data-testid="save-view-submit-btn"
              >
                {saving ? (
                  <>
                    <Loader2 size={14} className="spin" />
                    {t('savedViews.saving', 'Saving…')}
                  </>
                ) : (
                  t('savedViews.save')
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
