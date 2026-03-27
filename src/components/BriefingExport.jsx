import React from 'react';
import { useTranslation } from 'react-i18next';
import { X, Download, Printer, FileText } from 'lucide-react';
import { generateBriefingMarkdown } from '../utils/briefingMarkdown.js';

const BriefingExport = ({ events = [], filters = {}, onClose }) => {
  const { t } = useTranslation();

  const handleMarkdownDownload = () => {
    const today = new Date().toISOString().slice(0, 10);
    const markdown = generateBriefingMarkdown(events, filters);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mapr-briefing-${today}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleJsonDownload = () => {
    const today = new Date().toISOString().slice(0, 10);
    const payload = {
      exportedAt: new Date().toISOString(),
      filters,
      eventCount: events.length,
      events: events.map(e => ({
        id: e.id,
        title: e.title,
        severity: e.severity,
        lifecycle: e.lifecycle,
        countries: e.countries,
        entities: e.entities,
        confidence: e.confidence,
        articleCount: e.articleCount,
        firstSeenAt: e.firstSeenAt,
      })),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mapr-briefing-${today}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="export-modal-overlay" onClick={onClose}>
      <div className="export-modal" onClick={e => e.stopPropagation()}>
        <div className="export-modal-header">
          <span className="export-modal-title">{t('export.title')}</span>
          <button className="export-modal-close" onClick={onClose} aria-label={t('panel.closePanel')}>
            <X size={16} />
          </button>
        </div>

        <div className="export-modal-body">
          <button className="export-modal-card" onClick={handleMarkdownDownload}>
            <div className="export-modal-card-icon">
              <FileText size={22} />
            </div>
            <div className="export-modal-card-text">
              <span className="export-modal-card-title">{t('export.markdownTitle')}</span>
              <span className="export-modal-card-desc">
                {t('export.markdownDesc', { count: events.length })}
              </span>
            </div>
          </button>

          <button className="export-modal-card" onClick={handleJsonDownload}>
            <div className="export-modal-card-icon">
              <Download size={22} />
            </div>
            <div className="export-modal-card-text">
              <span className="export-modal-card-title">{t('export.jsonTitle')}</span>
              <span className="export-modal-card-desc">
                {t('export.jsonDesc', { count: events.length })}
              </span>
            </div>
          </button>

          <button className="export-modal-card" onClick={handlePrint}>
            <div className="export-modal-card-icon">
              <Printer size={22} />
            </div>
            <div className="export-modal-card-text">
              <span className="export-modal-card-title">{t('export.printTitle')}</span>
              <span className="export-modal-card-desc">
                {t('export.printDesc')}
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default BriefingExport;
