import React from 'react';
import { X, Download, Printer } from 'lucide-react';

const BriefingExport = ({ events = [], filters = {}, onClose }) => {
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
          <span className="export-modal-title">EXPORT BRIEFING</span>
          <button className="export-modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="export-modal-body">
          <button className="export-modal-card" onClick={handleJsonDownload}>
            <div className="export-modal-card-icon">
              <Download size={22} />
            </div>
            <div className="export-modal-card-text">
              <span className="export-modal-card-title">JSON Snapshot</span>
              <span className="export-modal-card-desc">
                Download a structured JSON file containing all {events.length} filtered
                events with metadata.
              </span>
            </div>
          </button>

          <button className="export-modal-card" onClick={handlePrint}>
            <div className="export-modal-card-icon">
              <Printer size={22} />
            </div>
            <div className="export-modal-card-text">
              <span className="export-modal-card-title">Print to PDF</span>
              <span className="export-modal-card-desc">
                Open the browser print dialog to save as PDF. The news panel will be
                formatted for print automatically.
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default BriefingExport;
