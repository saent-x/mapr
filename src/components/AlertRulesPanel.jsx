import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, BellOff, Pencil, Trash2, Plus, Loader2, LogIn } from 'lucide-react';
import { SignedIn, SignedOut } from './auth';
import useAlertRules from '../hooks/useAlertRules';
import useSavedViews from '../hooks/useSavedViews';
import useUIStore from '../stores/uiStore';
import useNewsStore from '../stores/newsStore';
import AlertRuleDialog from './AlertRuleDialog';

/**
 * Alert rules management panel in the sidebar.
 * Lists user's alert rules with match counts, toggle, edit, delete.
 * Auth-gated with SignedIn/SignedOut.
 */
export default function AlertRulesPanel() {
  const { t } = useTranslation();
  const liveNews = useNewsStore((s) => s.liveNews) || [];
  const { views: savedViews } = useSavedViews(liveNews);
  const { rules, isLoading, needsAuth, deleteRule, toggleActive } = useAlertRules(savedViews, liveNews);

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
      <div className="alert-rules-sidebar" role="region" aria-label={t('alertRules.panelLabel', 'Alert Rules')}>
        <SignedIn>
          <div className="saved-views-header micro">
            <Bell size={12} aria-hidden />
            <span>{t('alertRules.panelLabel', 'ALERT RULES')}</span>
            {activeCount > 0 && (
              <span style={{ color: 'var(--sev-red)', marginLeft: 'auto' }}>{activeCount}/{rules.length}</span>
            )}
          </div>

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
                        {t('alertRules.sevThresholdLabel', '≥')} {rule.severityLabel} · {rule.savedViewName}
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
            disabled={savedViews.length === 0}
            title={savedViews.length === 0 ? t('alertRules.needSavedView', 'Save a view first to create alert rules') : t('alertRules.newRule', 'New Alert Rule')}
          >
            <Plus size={11} aria-hidden />
            {t('alertRules.newRule', 'New Alert Rule')}
          </button>
        </SignedIn>

        <SignedOut>
          {needsAuth && (
            <div className="saved-views-login-prompt">
              <LogIn size={10} aria-hidden />
              <span>{t('alertRules.signInPrompt', 'Sign in to create alert rules')}</span>
            </div>
          )}
        </SignedOut>
      </div>

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
