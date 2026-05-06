import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Search, Layers, PanelRight, Menu, Keyboard } from 'lucide-react';

const STORAGE_KEY = 'mapr:onboarded';

/**
 * Check if the user has already completed onboarding.
 */
function isOnboarded() {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return true; // localStorage blocked — skip onboarding
  }
}

/**
 * Mark onboarding as complete in localStorage.
 */
function markOnboarded() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch { /* localStorage blocked */ }
}

/**
 * Individual callout card pointing to a feature.
 * Positioned absolutely via CSS class and a data-side attribute.
 */
function CalloutCard({ side, step, icon, title, description, connectorStyle }) {
  return (
    <div className={`onboard-callout onboard-callout--${side}`} role="listitem">
      <div className="onboard-callout-connector" style={connectorStyle} aria-hidden="true" />
      <div className="onboard-callout-step">{step}</div>
      <div className="onboard-callout-icon">{icon}</div>
      <div className="onboard-callout-body">
        <h4 className="onboard-callout-title">{title}</h4>
        <p className="onboard-callout-desc">{description}</p>
      </div>
    </div>
  );
}

/**
 * OnboardingOverlay — first-visit guided tour overlay.
 *
 * Shows feature callouts pointing to:
 *   1. Search bar (header)
 *   2. Severity layers (header overlays)
 *   3. News panel (right side)
 *   4. Sidebar navigation (left side)
 *   5. Keyboard shortcuts (bottom hint)
 *
 * Includes a centered "Getting Started" reference card and a "Got it" dismiss button.
 * Persisted via localStorage key `mapr:onboarded`.
 */
export default function OnboardingOverlay() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show if NOT already onboarded
    if (!isOnboarded()) {
      // Small delay to let the page paint before showing overlay
      const id = setTimeout(() => setVisible(true), 400);
      return () => clearTimeout(id);
    }
    return undefined;
  }, []);

  const dismiss = useCallback(() => {
    markOnboarded();
    setVisible(false);
  }, []);

  const handleBackdropClick = useCallback((e) => {
    // Only close if clicking the backdrop itself, not a callout
    if (e.target === e.currentTarget) {
      // Don't close on backdrop click — force explicit dismiss
    }
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!visible) return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        dismiss();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [visible, dismiss]);

  if (!visible) return null;

  const callouts = [
    {
      side: 'top-left',
      step: '01',
      icon: <Search size={16} aria-hidden />,
      title: t('onboarding.searchTitle'),
      description: t('onboarding.searchDesc'),
      connectorStyle: { top: '100%', left: '50%', width: '2px', height: '24px', borderLeft: '1px dashed var(--amber-dim)' },
    },
    {
      side: 'top-right',
      step: '02',
      icon: <Layers size={16} aria-hidden />,
      title: t('onboarding.layersTitle'),
      description: t('onboarding.layersDesc'),
      connectorStyle: { top: '100%', left: '50%', width: '2px', height: '24px', borderLeft: '1px dashed var(--amber-dim)' },
    },
    {
      side: 'left-mid',
      step: '03',
      icon: <Menu size={16} aria-hidden />,
      title: t('onboarding.sidebarTitle'),
      description: t('onboarding.sidebarDesc'),
      connectorStyle: { top: '50%', right: '100%', width: '24px', height: '2px', borderTop: '1px dashed var(--amber-dim)' },
    },
    {
      side: 'right-mid',
      step: '04',
      icon: <PanelRight size={16} aria-hidden />,
      title: t('onboarding.panelsTitle'),
      description: t('onboarding.panelsDesc'),
      connectorStyle: { top: '50%', left: '100%', width: '24px', height: '2px', borderTop: '1px dashed var(--amber-dim)' },
    },
    {
      side: 'bottom-center',
      step: '05',
      icon: <Keyboard size={16} aria-hidden />,
      title: t('onboarding.shortcutsTitle'),
      description: t('onboarding.shortcutsDesc'),
      connectorStyle: { bottom: '100%', left: '50%', width: '2px', height: '24px', borderLeft: '1px dashed var(--amber-dim)' },
    },
  ];

  return (
    <div
      className="onboard-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={t('onboarding.title')}
    >
      {/* Close (X) button */}
      <button
        type="button"
        className="onboard-close"
        onClick={dismiss}
        aria-label={t('onboarding.close')}
      >
        <X size={18} aria-hidden />
      </button>

      {/* Feature callouts */}
      <div className="onboard-callouts" role="list" aria-label={t('onboarding.featuresLabel')}>
        {callouts.map((c) => (
          <CalloutCard key={c.step} {...c} />
        ))}
      </div>

      {/* Getting Started reference card — centered */}
      <div className="onboard-getting-started">
        <div className="onboard-gs-header">
          <h2 className="onboard-gs-title">{t('onboarding.gettingStartedTitle')}</h2>
          <div className="onboard-gs-accent" aria-hidden="true" />
        </div>

        <div className="onboard-gs-body">
          <div className="onboard-gs-grid">
            <div className="onboard-gs-item">
              <span className="onboard-gs-label">{t('onboarding.gsSearch')}</span>
              <span className="onboard-gs-text">{t('onboarding.gsSearchDesc')}</span>
            </div>
            <div className="onboard-gs-item">
              <span className="onboard-gs-label">{t('onboarding.gsFilter')}</span>
              <span className="onboard-gs-text">{t('onboarding.gsFilterDesc')}</span>
            </div>
            <div className="onboard-gs-item">
              <span className="onboard-gs-label">{t('onboarding.gsSeverity')}</span>
              <span className="onboard-gs-text">{t('onboarding.gsSeverityDesc')}</span>
            </div>
            <div className="onboard-gs-item">
              <span className="onboard-gs-label">{t('onboarding.gsShortcuts')}</span>
              <span className="onboard-gs-text">{t('onboarding.gsShortcutsDesc')}</span>
            </div>
            <div className="onboard-gs-item">
              <span className="onboard-gs-label">{t('onboarding.gsBookmark')}</span>
              <span className="onboard-gs-text">{t('onboarding.gsBookmarkDesc')}</span>
            </div>
            <div className="onboard-gs-item">
              <span className="onboard-gs-label">{t('onboarding.gsSaveView')}</span>
              <span className="onboard-gs-text">{t('onboarding.gsSaveViewDesc')}</span>
            </div>
          </div>
        </div>

        <div className="onboard-gs-footer">
          <button
            type="button"
            className="onboard-got-it-btn"
            onClick={dismiss}
          >
            {t('onboarding.gotIt')}
          </button>
        </div>
      </div>
    </div>
  );
}
