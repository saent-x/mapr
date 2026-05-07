import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Copy, FileDown } from 'lucide-react';
import useUIStore from '../stores/uiStore';
import { generateBriefingMarkdown } from '../utils/briefingMarkdown';
import { generateBriefingPdf } from '../utils/briefingPdf';

/**
 * BriefingExportModal — export modal with clipboard (markdown) and PDF options.
 *
 * Controlled by uiStore.showExport. Emits success toasts.
 *
 * Props:
 *  - events: filtered event array
 *  - filters: active filter state object
 *  - mapContainerRef: ref to map DOM element for html2canvas capture
 */
const BriefingExportModal = ({ events = [], filters = {}, mapContainerRef }) => {
  const { t } = useTranslation();
  const setShowExport = useUIStore((s) => s.setShowExport);
  const addToast = useUIStore((s) => s.addToast);
  const isOpen = useUIStore((s) => s.showExport);
  const modalRef = useRef(null);

  const handleClose = useCallback(() => {
    setShowExport(false);
  }, [setShowExport]);

  const handleBackdropClick = useCallback((e) => {
    if (modalRef.current && !modalRef.current.contains(e.target)) {
      handleClose();
    }
  }, [handleClose]);

  const handleCopyClipboard = useCallback(async () => {
    if (events.length === 0) {
      addToast(t('export.noEvents', 'No events to export'), 'info');
      return;
    }
    try {
      const markdown = generateBriefingMarkdown(events, filters);
      await navigator.clipboard.writeText(markdown);
      addToast(t('export.clipboardSuccess', 'Briefing copied to clipboard'), 'info');
      setShowExport(false);
    } catch (err) {
      console.warn('Clipboard write failed:', err);
      addToast('Failed to copy to clipboard', 'error');
    }
  }, [events, filters, addToast, setShowExport, t]);

  const handleExportPdf = useCallback(async () => {
    if (events.length === 0) {
      addToast(t('export.noEvents', 'No events to export'), 'info');
      return;
    }
    try {
      const mapEl = mapContainerRef?.current || document.querySelector('.map-stage, .maplibregl-map, [class*="map-container"]');
      await generateBriefingPdf(events, filters, {
        mapElement: mapEl,
        onSuccess: () => {
          addToast(t('export.pdfSuccess', 'PDF exported successfully'), 'info');
          setShowExport(false);
        },
        onError: (err) => {
          addToast(`PDF export failed: ${err.message}`, 'error');
        },
      });
    } catch (err) {
      console.warn('PDF export failed:', err);
      addToast('PDF export failed', 'error');
    }
  }, [events, filters, addToast, setShowExport, t, mapContainerRef]);

  if (!isOpen) return null;

  return (
    <div className="export-modal-backdrop" onClick={handleBackdropClick} role="dialog" aria-modal="true" aria-label={t('export.title', 'Export Briefing')}>
      <div className="export-modal" ref={modalRef}>
        <div className="panel-header">
          <span className="dot" />
          <span>{t('export.title', 'Export Briefing')}</span>
          <span className="spacer" />
          <button type="button" onClick={handleClose} aria-label={t('export.close', 'Close')}>
            <X size={12} aria-hidden />
          </button>
        </div>

        <div className="export-modal-body">
          <p className="micro" style={{ marginBottom: 16, color: 'var(--ink-2)' }}>
            {events.length === 0
              ? t('export.noEvents', 'No events to export')
              : `${events.length} events · ${t('export.filterSummary', 'Active Filters')}: ${filters.minSeverity > 0 ? `≥${filters.minSeverity}` : 'none'}`}
          </p>

          <div className="export-actions">
            <button
              type="button"
              className="btn primary"
              onClick={handleCopyClipboard}
              disabled={events.length === 0}
              aria-label={t('export.copyClipboard', 'Copy to Clipboard')}
            >
              <Copy size={14} aria-hidden />
              <span>{t('export.copyClipboard', 'Copy to Clipboard')}</span>
            </button>

            <button
              type="button"
              className="btn"
              onClick={handleExportPdf}
              disabled={events.length === 0}
              aria-label={t('export.exportPdf', 'Export PDF')}
            >
              <FileDown size={14} aria-hidden />
              <span>{t('export.exportPdf', 'Export PDF')}</span>
            </button>
          </div>

          <div className="export-modal-desc" style={{ marginTop: 16 }}>
            <span className="micro" style={{ color: 'var(--ink-2)' }}>
              {t('export.markdownDesc', 'Download a formatted markdown file with all {{count}} events, severity breakdown, and region statistics.', { count: events.length })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BriefingExportModal;
