import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, BellOff, Trash2, Plus, Loader2, Crown, Mail, ShieldCheck } from 'lucide-react';
import useAlertRules from '../hooks/useAlertRules';
import useSavedViews from '../hooks/useSavedViews';
import useUIStore from '../stores/uiStore';
import useNewsStore from '../stores/newsStore';
import useSubscription from '../hooks/useSubscription';
import AlertRuleDialog from './AlertRuleDialog';

/**
 * Alert rules management panel in the sidebar.
 * Lists user's alert rules with match counts, toggle, edit, delete.
 * Auth-gated with SignedIn/SignedOut.
 */
export default function AlertRulesPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const liveNews = useNewsStore((s) => s.liveNews) || [];
  const { views: savedViews } = useSavedViews(liveNews);
  const { rules, isLoading, needsAuth, deleteRule, toggleActive } = useAlertRules(savedViews, liveNews);
  const { upgradeToPro, hasFeatureAccess } = useSubscription();
  const canUseAlertRules = hasFeatureAccess('alertRules');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);

  // Count active rules
  const activeCount = rules.filter((r) => r.active).length;

  const handleCreate = useCallback(() => {
    setEditingRule(null);
    setDialogOpen(true);
  }, []);

  const handleEdit = useCallback((rule) => {
    setEditingRule(rule);
    setDialogOpen(true);
  }, []);

  const handleDialogClose = useCallback((saved) => {
    setDialogOpen(false);
    setEditingRule(null);
    if (saved) {
      const addToast = useUIStore.getState().addToast;
      addToast(
        editingRule
          ? t('alertRules.updated', 'Alert rule updated')
          : t('alertRules.created', 'Alert rule created'),
        'info',
      );
    }
  }, [editingRule, t]);

  const handleDelete = useCallback(async (rule) => {
    try {
      await deleteRule(rule.id);
      useUIStore.getState().addToast(
        t('alertRules.deleted', { name: rule.name }),
        'info',
      );
    } catch {
      // silently ignore — InstantDB query will auto-remove from list
    }
  }, [deleteRule, t]);

  const handleToggle = useCallback(async (rule) => {
    try {
      await toggleActive(rule);
    } catch {
      // silently ignore
    }
  }, [toggleActive]);

  const handleSignIn = () => {
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    navigate(`/login?returnUrl=${returnUrl}`);
  };

  /* ── Toast notifications for new matches on active rules ── */
  const prevNewMatchesRef = useRef({});
  useEffect(() => {
    if (!rules.length) return;
    const addToast = useUIStore.getState().addToast;
    for (const rule of rules) {
      if (!rule.active) continue;
      const newArticles = rule.newMatchArticles || [];
      if (newArticles.length === 0) continue;

      // Skip if we've already toasted these matches
      const prevIds = prevNewMatchesRef.current[rule.id] || new Set();
      const trulyNew = newArticles.filter((a) => !prevIds.has(a.id));
      if (trulyNew.length === 0) continue;

      // Update tracking
      const currentIds = new Set(newArticles.map((a) => a.id));
      prevNewMatchesRef.current[rule.id] = currentIds;

      if (trulyNew.length === 1) {
        const article = trulyNew[0];
        addToast(
          `🔔 ${rule.name}: ${article.title || t('alertRules.newMatch', 'New match')}`,
          'watch-alert',
        );
      } else {
        addToast(
          `🔔 ${rule.name}: ${trulyNew.length} ${t('alertRules.newMatches', 'new matches')}`,
          'watch-alert',
        );
      }
    }
  }, [rules, t]);

  return (
    <>
      {needsAuth ? (
        <div className="alert-rules-sidebar sidebar-pro-feature-slot" role="region" aria-label={t('alertRules.panelLabel', 'Alert Rules')}>
          <button
            type="button"
            className="sidebar-pro-feature-action"
            onClick={handleSignIn}
            title={t('alertRules.signInPrompt', 'Sign in to create alert rules')}
            aria-label={t('alertRules.signInPrompt', 'Sign in to create alert rules')}
          >
            <Bell size={18} aria-hidden />
            <span className="sidebar-pro-feature-label">{t('alertRules.panelLabel', 'Alert rules')}</span>
            <span className="sidebar-pro-badge" aria-label="Pro feature">
              <Crown size={7} aria-hidden />
            </span>
          </button>
        </div>
      ) : (
      <div className="alert-rules-sidebar" role="region" aria-label={t('alertRules.panelLabel', 'Alert Rules')}>
        <div className="saved-views-header micro">
          <Bell size={12} aria-hidden />
          <span>{t('alertRules.panelLabel', 'ALERT RULES')}</span>
          {rules.length > 0 && (
            <span
              className="saved-views-count sidebar-section-count-badge"
              title={t('alertRules.activeCountTitle', {
                active: activeCount,
                total: rules.length,
                defaultValue: `${activeCount} active of ${rules.length} alert rules`,
              })}
              aria-label={t('alertRules.countAriaLabel', { count: rules.length, defaultValue: `${rules.length} alert rules` })}
            >
              {rules.length}
            </span>
          )}
        </div>

        {!canUseAlertRules && rules.length === 0 ? (
          <div className="saved-views-login-prompt" style={{ cursor: 'pointer' }} onClick={() => upgradeToPro().catch(() => {})}>
            <Crown size={10} aria-hidden />
            <span>{t('subscription.upgradeToPro', 'Upgrade to Pro')}</span>
          </div>
        ) : (
          <>
            {isLoading && (
              <div className="saved-views-loading">
                <Loader2 size={12} className="spin" />
              </div>
            )}

            {!isLoading && rules.length === 0 && (
              <div className="saved-views-empty">
                {t('alertRules.emptyHint', 'Create alert rules from saved views to get notified of matching events')}
              </div>
            )}

            {!isLoading && rules.length > 0 && (
              <ul className="saved-views-list" role="list">
                {rules.map((rule) => (
                  <li key={rule.id} className="saved-views-item alert-rules-item">
                    <div className="alert-rules-item-inner">
                      {/* Active/inactive toggle */}
                      <button
                        type="button"
                        className="alert-rules-toggle"
                        onClick={() => handleToggle(rule)}
                        title={rule.active ? t('alertRules.deactivate', 'Deactivate') : t('alertRules.activate', 'Activate')}
                        aria-label={rule.active ? t('alertRules.deactivateAria', { name: rule.name }) : t('alertRules.activateAria', { name: rule.name })}
                        data-active={rule.active || undefined}
                      >
                        {rule.active ? <Bell size={11} /> : <BellOff size={11} />}
                      </button>

                      {/* Rule info */}
                      <button
                        type="button"
                        className="alert-rules-info-btn"
                        onClick={() => handleEdit(rule)}
                        title={t('alertRules.editTitle', 'Edit Alert Rule')}
                      >
                        <span className="alert-rules-name">{rule.name}</span>
                        <span className="alert-rules-meta">
                          {t('alertRules.sevThresholdLabel', '≥')} {rule.severityLabel} · {rule.minConfidence}% conf · {rule.savedViewName}
                        </span>
                        <span className="alert-rules-premium-meta">
                          <ShieldCheck size={9} aria-hidden />
                          {rule.deliveryMode}
                          {rule.channels?.email && <><Mail size={9} aria-hidden /> email</>}
                          {rule.quietHours?.enabled && <> · quiet</>}
                        </span>
                      </button>

                      {/* Match count badge */}
                      <span
                        className="saved-views-count"
                        title={t('alertRules.matchCountTitle', { count: rule.matchCount })}
                        data-alert-count={rule.active && rule.matchCount > 0 ? 'active' : undefined}
                      >
                        {rule.matchCount}
                      </span>

                      {/* Delete button */}
                      <button
                        type="button"
                        className="saved-views-delete alert-rules-delete"
                        onClick={() => handleDelete(rule)}
                        title={t('alertRules.delete', 'Delete')}
                        aria-label={t('alertRules.deleteAria', { name: rule.name })}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Create new rule button */}
            <button
              type="button"
              className="alert-rules-create-btn"
              onClick={handleCreate}
              disabled={savedViews.length === 0 || !canUseAlertRules}
              title={!canUseAlertRules ? t('subscription.proRequired', 'Pro Subscription Required') : savedViews.length === 0 ? t('alertRules.needSavedView', 'Save a view first to create alert rules') : t('alertRules.newRule', 'New Alert Rule')}
            >
              <Plus size={11} aria-hidden />
              {t('alertRules.newRule', 'New Alert Rule')}
            </button>
          </>
        )}
      </div>
      )}

      {/* Create/Edit dialog */}
      <AlertRuleDialog
        isOpen={dialogOpen}
        onClose={handleDialogClose}
        savedViews={savedViews}
        editRule={editingRule}
      />
    </>
  );
}
