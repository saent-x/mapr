import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

/**
 * Shortcut groups — organized by context.
 * Each shortcut has: key (display key label), description (i18n key), and optional keys (combo display).
 */
const SHORTCUT_GROUPS = [
  {
    id: 'global',
    labelKey: 'shortcutHelp.sectionGlobal',
    shortcuts: [
      { key: '?', i18nKey: 'shortcutHelp.openHelp' },
      { key: '/', i18nKey: 'shortcutHelp.focusSearch' },
      { key: 'S', i18nKey: 'shortcutHelp.saveView' },
      { key: 'R', i18nKey: 'shortcutHelp.refresh' },
      { key: 'G', i18nKey: 'shortcutHelp.toggleGlobe' },
      { key: 'F', i18nKey: 'shortcutHelp.toggleFilters' },
      { key: 'Esc', i18nKey: 'shortcutHelp.closePanels' },
      { key: '⌘K', i18nKey: 'shortcutHelp.commandSearch' },
    ],
  },
  {
    id: 'newsPanel',
    labelKey: 'shortcutHelp.sectionNews',
    shortcuts: [
      { key: 'J', i18nKey: 'shortcutHelp.navDown' },
      { key: 'K', i18nKey: 'shortcutHelp.navUp' },
      { key: 'Enter', i18nKey: 'shortcutHelp.expandItem' },
      { key: 'B', i18nKey: 'shortcutHelp.bookmark' },
    ],
  },
  {
    id: 'map',
    labelKey: 'shortcutHelp.sectionMap',
    shortcuts: [
      { key: 'Tab', i18nKey: 'shortcutHelp.focusCycle' },
      { key: 'Esc', i18nKey: 'shortcutHelp.closeOverlay' },
    ],
  },
  {
    id: 'filters',
    labelKey: 'shortcutHelp.sectionFilters',
    shortcuts: [
      { key: 'F', i18nKey: 'shortcutHelp.drawerToggle' },
      { key: 'Esc', i18nKey: 'shortcutHelp.drawerClose' },
    ],
  },
  {
    id: 'entityGraph',
    labelKey: 'shortcutHelp.sectionEntities',
    shortcuts: [
      { key: 'J', i18nKey: 'shortcutHelp.navDown' },
      { key: 'K', i18nKey: 'shortcutHelp.navUp' },
      { key: 'Enter', i18nKey: 'shortcutHelp.expandItem' },
    ],
  },
];

/**
 * ShortcutHelp — keyboard shortcut reference overlay.
 *
 * Opens on the ? key (Shift+/), dispatched as `mapr:openShortcutHelp` CustomEvent.
 * Closes on Escape key and backdrop click. Styled in MAPR tactical monospace aesthetic.
 */
export default function ShortcutHelp() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // Listen for the custom event dispatched by keyboard handlers across pages
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('mapr:openShortcutHelp', handler);
    return () => window.removeEventListener('mapr:openShortcutHelp', handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Close on backdrop click
  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      setOpen(false);
    }
  }, []);

  // Close via X button
  const handleClose = useCallback(() => setOpen(false), []);

  if (!open) return null;

  return (
    <div
      className="shortcut-help-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={t('shortcutHelp.title')}
    >
      <div className="shortcut-help-panel">
        <div className="shortcut-help-header">
          <h2 className="shortcut-help-title">{t('shortcutHelp.title')}</h2>
          <button
            type="button"
            className="shortcut-help-close"
            onClick={handleClose}
            aria-label={t('shortcutHelp.close')}
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className="shortcut-help-body">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.id} className="shortcut-help-section">
              <h3 className="shortcut-help-section-title">
                {t(group.labelKey)}
              </h3>
              <div className="shortcut-help-list">
                {group.shortcuts.map((sc, idx) => (
                  <div key={`${group.id}-${idx}`} className="shortcut-help-row">
                    <kbd className="shortcut-help-kbd">{sc.key}</kbd>
                    <span className="shortcut-help-desc">{t(sc.i18nKey)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="shortcut-help-footer">
          <span className="shortcut-help-footer-text">{t('shortcutHelp.footer')}</span>
        </div>
      </div>
    </div>
  );
}
