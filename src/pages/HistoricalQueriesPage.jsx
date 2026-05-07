import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import HistoricalQueriesPanel from '../components/HistoricalQueriesPanel';

/**
 * HistoricalQueriesPage — dedicated page for historical time-range queries,
 * date range selection, period comparison, and time travel.
 */
export default function HistoricalQueriesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleClose = () => {
    navigate('/');
  };

  return (
    <div className="mapr-historical-page">
      <div className="mapr-historical-page-header">
        <button
          className="mapr-back-btn"
          onClick={() => navigate(-1)}
          type="button"
          title={t('nav.backToMap')}
        >
          <ArrowLeft size={18} />
        </button>
        <h2 className="mapr-historical-page-title">{t('historicalQueries.pageTitle')}</h2>
      </div>
      <div className="mapr-historical-page-content">
        <HistoricalQueriesPanel onClose={handleClose} />
      </div>
      <style>{`
        .mapr-historical-page {
          padding: 16px;
          max-width: 640px;
          margin: 0 auto;
        }
        .mapr-historical-page-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
        }
        .mapr-back-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: var(--bg-1);
          color: var(--text-1);
          cursor: pointer;
        }
        .mapr-back-btn:hover {
          color: var(--amber);
          border-color: var(--amber);
        }
        .mapr-historical-page-title {
          font-size: 1rem;
          font-weight: 600;
          color: var(--text-0);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .mapr-historical-page-content {
          /* constrained width for form */
        }
      `}</style>
    </div>
  );
}
