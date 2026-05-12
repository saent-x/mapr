import React, { useEffect, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import db from '../services/instantDb';
import useFilterStore from '../stores/filterStore';
import useUIStore from '../stores/uiStore';
import PageLoadingFallback from '../components/PageLoadingFallback.jsx';

/**
 * /v/:token — read-only entry point for a shared saved view.
 * Looks up the view by shareToken, applies its filters + map state, then
 * navigates the user to /. The view is not editable from this route.
 */
export default function SharedViewPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const applyView = useFilterStore((s) => s.applyView);
  const setActiveViewId = useUIStore((s) => s.setActiveViewId);

  const { data, isLoading, error } = db.useQuery(
    token
      ? { savedViews: { $: { where: { shareToken: token }, limit: 1 } } }
      : null,
  );

  const view = useMemo(() => data?.savedViews?.[0] || null, [data]);

  useEffect(() => {
    if (!view) return;
    try {
      applyView({ filters: view.filterState || {}, mapState: view.mapState || {} });
      if (view.mapState?.mapMode) useUIStore.getState().setMapMode(view.mapState.mapMode);
      setActiveViewId(null);
      navigate('/', { replace: true });
    } catch (err) {
      console.warn('failed to apply shared view', err.message);
    }
  }, [view, applyView, setActiveViewId, navigate]);

  if (isLoading) return <PageLoadingFallback />;

  if (error || !view) {
    return (
      <div className="shared-view-page">
        <div className="threads-empty" data-testid="shared-view-not-found">
          <div className="mono threads-empty-title">{t('savedViews.shareNotFoundTitle', 'SHARED VIEW NOT FOUND')}</div>
          <p className="threads-empty-body">
            {t('savedViews.shareNotFoundBody', 'This share link may have been revoked or never existed.')}
          </p>
          <Link to="/" className="btn primary">{t('common.goHome', 'Go home')}</Link>
        </div>
      </div>
    );
  }

  return <PageLoadingFallback />;
}
