import { useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { getCoverageMeta, COVERAGE_STATUS_ORDER } from '../utils/coverageMeta';
import { getRegionCoverageHistory } from '../utils/coverageHistory';

/* ── helpers ── */

function buildReasoning(entry) {
  if (!entry) return '';

  const parts = [];

  if (entry.verifiedCount > 0) {
    parts.push(`${entry.verifiedCount} verified event${entry.verifiedCount !== 1 ? 's' : ''}`);
  } else if (entry.eventCount > 0) {
    parts.push(`${entry.eventCount} event${entry.eventCount !== 1 ? 's' : ''} (none verified)`);
  }

  if (entry.feedCount > 0) {
    const healthy = entry.healthyFeeds || 0;
    const failed = entry.failedFeeds || 0;
    const empty = entry.emptyFeeds || 0;
    if (failed > 0) {
      parts.push(`${healthy}/${entry.feedCount} feeds healthy, ${failed} failed`);
    } else if (empty > 0) {
      parts.push(`${healthy}/${entry.feedCount} feeds healthy, ${empty} empty`);
    } else {
      parts.push(`${healthy}/${entry.feedCount} feeds healthy`);
    }
  } else {
    parts.push('No active feeds for this country');
  }

  return parts.join(' · ');
}

function sourceLabel(status) {
  switch (status) {
    case 'ok': return 'active';
    case 'failed': return 'failed';
    case 'empty': return 'empty';
    default: return status || 'unknown';
  }
}

function sourceBadgeColor(status) {
  switch (status) {
    case 'ok': return 'var(--sev-green, #5ec269)';
    case 'failed': return 'var(--sev-red, #d25757)';
    case 'empty': return 'var(--amber, #d9a441)';
    default: return 'var(--ink-2)';
  }
}

/* ── sparkline ── */

function Sparkline({ dataPoints, width = 160, height = 32 }) {
  if (!dataPoints || dataPoints.length < 2) {
    return (
      <div className="coverage-drill-sparkline-empty" style={{ width, height }}>
        <span className="micro">—</span>
      </div>
    );
  }

  const values = dataPoints.map((d) => d.eventCount ?? d.value ?? 0);
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const range = max - min || 1;

  const padding = 2;
  const plotW = width - padding * 2;
  const plotH = height - padding * 2;

  const points = values.map((v, i) => {
    const x = padding + (i / Math.max(values.length - 1, 1)) * plotW;
    const y = padding + plotH - ((v - min) / range) * plotH;
    return `${x},${y}`;
  });

  const pathD = points.map((p, i) => (i === 0 ? `M${p}` : `L${p}`)).join(' ');

  const fillD = `${pathD} L${padding + plotW},${padding + plotH} L${padding},${padding + plotH} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="coverage-drill-sparkline"
      aria-label="Coverage history sparkline"
      role="img"
    >
      <path d={fillD} fill="var(--amber, #d9a441)" fillOpacity="0.12" />
      <path d={pathD} fill="none" stroke="var(--amber, #d9a441)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      {values.length <= 8 && points.map((p, i) => (
        <circle key={i} cx={p.split(',')[0]} cy={p.split(',')[1]} r="1.8" fill="var(--amber, #d9a441)" />
      ))}
    </svg>
  );
}

/* ── component ── */

const CoverageDrilldown = ({
  iso,
  coverageEntry,
  coverageHistory,
  sourceHealth,
  onClose,
}) => {
  const { t } = useTranslation();

  const panelRef = useRef(null);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    // Delay to avoid the same click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handleClick);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handleClick);
    };
  }, [onClose]);

  const regionName = coverageEntry?.region || iso || '—';
  const status = coverageEntry?.status || 'uncovered';
  const meta = getCoverageMeta(status);
  const confidence = coverageEntry?.maxConfidence || 0;
  const reasoning = useMemo(() => buildReasoning(coverageEntry), [coverageEntry]);

  // Build region coverage history for sparkline
  const regionHistory = useMemo(() => {
    if (!iso || !coverageHistory) return null;
    return getRegionCoverageHistory(coverageHistory, iso, 8, 4);
  }, [iso, coverageHistory]);

  const sparklinePoints = useMemo(() => {
    if (!regionHistory?.snapshots || regionHistory.snapshots.length < 2) return [];
    // Reverse to chronological order (oldest first) for the sparkline
    return [...regionHistory.snapshots].reverse();
  }, [regionHistory]);

  // Compute source feed counts
  const feedCount = coverageEntry?.feedCount || 0;
  const healthyFeeds = coverageEntry?.healthyFeeds || 0;
  const failedFeeds = coverageEntry?.failedFeeds || 0;
  const emptyFeeds = coverageEntry?.emptyFeeds || 0;

  const sourceFeeds = useMemo(() => {
    if (!iso || !sourceHealth?.rss?.feeds) return [];
    return sourceHealth.rss.feeds.filter((feed) => {
      const coverageIsos = Array.isArray(feed.coverageIsoA2s) && feed.coverageIsoA2s.length > 0
        ? feed.coverageIsoA2s
        : [feed.isoA2].filter(Boolean);
      return coverageIsos.includes(iso) || feed.isoA2 === iso;
    });
  }, [iso, sourceHealth]);

  // I18n label for the status
  const statusLabel = meta.labelKey ? t(`coverageStatus.${meta.labelKey}`) : status;

  return (
    <div
      ref={panelRef}
      className="coverage-drilldown"
      role="dialog"
      aria-label={`${regionName} ${t('coverageDrill.title', 'Coverage Details')}`}
    >
      {/* Header */}
      <div className="coverage-drill-header">
        <div className="coverage-drill-header-left">
          <span className="coverage-drill-region-name">{regionName}</span>
          <span
            className="coverage-drill-status-badge"
            style={{ background: meta.accent, color: '#000' }}
          >
            {statusLabel.toUpperCase()}
          </span>
        </div>
        <button
          type="button"
          className="coverage-drill-close"
          onClick={onClose}
          aria-label={t('panel.closePanel')}
        >
          <X size={12} aria-hidden />
        </button>
      </div>

      {/* Body */}
      <div className="coverage-drill-body">
        {/* Confidence + Reasoning */}
        <div className="coverage-drill-section">
          <span className="micro">{t('map.confidence')}</span>
          <div className="coverage-drill-confidence-row">
            <span
              className="coverage-drill-confidence-value"
              style={{ color: meta.accent }}
            >
              {confidence}%
            </span>
          </div>
          <p className="coverage-drill-reasoning">{reasoning}</p>
        </div>

        {/* Source feeds breakdown */}
        {feedCount > 0 && (
          <div className="coverage-drill-section">
            <span className="micro">{t('map.sourceFeeds')} ({feedCount})</span>
            <div className="coverage-drill-source-counts">
              <div className="coverage-drill-source-row">
                <span className="coverage-drill-source-dot" style={{ background: 'var(--sev-green, #5ec269)' }} />
                <span className="coverage-drill-source-label">{t('coverageDrill.active', 'Active')}</span>
                <span className="coverage-drill-source-count">{healthyFeeds}</span>
              </div>
              {failedFeeds > 0 && (
                <div className="coverage-drill-source-row">
                  <span className="coverage-drill-source-dot" style={{ background: 'var(--sev-red, #d25757)' }} />
                  <span className="coverage-drill-source-label">{t('coverageDrill.failed', 'Failed')}</span>
                  <span className="coverage-drill-source-count">{failedFeeds}</span>
                </div>
              )}
              {emptyFeeds > 0 && (
                <div className="coverage-drill-source-row">
                  <span className="coverage-drill-source-dot" style={{ background: 'var(--amber, #d9a441)' }} />
                  <span className="coverage-drill-source-label">{t('coverageDrill.empty', 'Empty')}</span>
                  <span className="coverage-drill-source-count">{emptyFeeds}</span>
                </div>
              )}
            </div>

            {/* Individual source feeds list */}
            {sourceFeeds.length > 0 && (
              <div className="coverage-drill-feed-list">
                {sourceFeeds.slice(0, 15).map((feed, idx) => (
                  <div key={feed.feedId || idx} className="coverage-drill-feed-item">
                    <span
                      className="coverage-drill-feed-dot"
                      style={{ background: sourceBadgeColor(feed.status) }}
                    />
                    <span className="coverage-drill-feed-name">
                      {feed.name || feed.feedId || `Feed ${idx + 1}`}
                    </span>
                    <span
                      className="coverage-drill-feed-status"
                      style={{ color: sourceBadgeColor(feed.status) }}
                    >
                      {sourceLabel(feed.status)}
                    </span>
                  </div>
                ))}
                {sourceFeeds.length > 15 && (
                  <div className="coverage-drill-feed-more">
                    +{sourceFeeds.length - 15} more
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {feedCount === 0 && coverageEntry && (
          <div className="coverage-drill-section">
            <span className="micro">{t('map.sourceFeeds')}</span>
            <p className="coverage-drill-reasoning" style={{ color: 'var(--ink-2)' }}>
              {t('coverageDrill.noFeeds', 'No source feeds configured for this country')}
            </p>
          </div>
        )}

        {/* Event counts */}
        {coverageEntry && (coverageEntry.eventCount > 0 || coverageEntry.verifiedCount > 0) && (
          <div className="coverage-drill-section">
            <span className="micro">{t('map.reports')}</span>
            <div className="coverage-drill-event-counts">
              <div className="coverage-drill-source-row">
                <span className="coverage-drill-source-label">{t('coverageDrill.totalEvents', 'Total events')}</span>
                <span className="coverage-drill-source-count">{coverageEntry.eventCount || 0}</span>
              </div>
              <div className="coverage-drill-source-row">
                <span className="coverage-drill-source-label">{t('coverageDrill.verifiedEvents', 'Verified')}</span>
                <span className="coverage-drill-source-count" style={{ color: 'var(--sev-green, #5ec269)' }}>{coverageEntry.verifiedCount || 0}</span>
              </div>
            </div>
          </div>
        )}

        {/* Sparkline */}
        {sparklinePoints.length >= 2 && (
          <div className="coverage-drill-section">
            <span className="micro">
              {t('coverageDrill.recentHistory', 'Recent coverage')}
              {' '}
              <span className="coverage-drill-sparkline-count">({sparklinePoints.length})</span>
            </span>
            <Sparkline dataPoints={sparklinePoints} width={200} height={36} />
          </div>
        )}

        {/* Coverage transitions */}
        {regionHistory?.transitions?.length > 0 && (
          <div className="coverage-drill-section">
            <span className="micro">{t('coverageDrill.statusChanges', 'Recent changes')}</span>
            {regionHistory.transitions.slice(0, 3).map((tx, i) => {
              const fromMeta = getCoverageMeta(tx.fromStatus);
              const toMeta = getCoverageMeta(tx.toStatus);
              return (
                <div key={i} className="coverage-drill-transition">
                  <span className="coverage-drill-transition-dot" style={{ background: fromMeta.accent }} />
                  <span className="coverage-drill-transition-arrow">→</span>
                  <span className="coverage-drill-transition-dot" style={{ background: toMeta.accent }} />
                  <span className="coverage-drill-transition-label">
                    {t(`coverageStatus.${fromMeta.labelKey}`)} → {t(`coverageStatus.${toMeta.labelKey}`)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CoverageDrilldown;
