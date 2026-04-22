import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { isoToCountry } from '../utils/geocoder.js';
import { buildAnomalyList } from '../utils/anomalyUtils.js';
import useUIStore from '../stores/uiStore.js';

function Sparkline({ data, color = 'var(--sev-red)', w = 34, h = 18 }) {
  if (!data || data.length < 2) {
    return <svg className="anomaly-sparkline" width={w} height={h} aria-hidden />;
  }
  const max = Math.max(...data);
  const min = Math.min(...data);
  const rng = Math.max(1, max - min);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / rng) * h}`).join(' ');
  return (
    <svg className="anomaly-sparkline" width={w} height={h} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * AnomalyPanel — left mini-panel showing velocity spikes + silence entries.
 * Wired directly into the design shell's `.side-panels` column.
 */
const AnomalyPanel = ({
  velocitySpikes = [],
  silenceEntries = [],
  isOpen,
  onClose,
  onRegionSelect,
}) => {
  const { t } = useTranslation();

  const anomalies = useMemo(
    () => buildAnomalyList({ velocitySpikes, silenceEntries }),
    [velocitySpikes, silenceEntries],
  );

  const collapsed = useUIStore((s) => s.panelCollapsed.anomaly);
  const togglePanelCollapsed = useUIStore((s) => s.togglePanelCollapsed);

  const bodyStyle = isOpen ? { maxHeight: 'none' } : undefined;

  return (
    <div className="mini-panel" data-collapsed={collapsed || undefined} role="region" aria-label={t('anomaly.title')}>
      <div className="panel-header">
        <span className="dot" style={{ background: 'var(--sev-red)' }} />
        {t('anomaly.title')}
        <span className="spacer" />
        <span style={{ color: 'var(--ink-2)' }}>{anomalies.length}</span>
        <button
          type="button"
          className="panel-collapse-btn"
          onClick={() => togglePanelCollapsed('anomaly')}
          aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronDown size={12} aria-hidden /> : <ChevronUp size={12} aria-hidden />}
        </button>
        {isOpen && (
          <button type="button" onClick={onClose} aria-label={t('panel.closePanel')}>×</button>
        )}
      </div>
      <div className="panel-body" style={bodyStyle} aria-hidden={collapsed || undefined}>
        {anomalies.length === 0 && (
          <div className="mini-panel-empty">NO ANOMALIES DETECTED</div>
        )}
        {anomalies.map((a, i) => {
          const country = isoToCountry(a.iso) || a.iso;
          const isSpike = a.category === 'velocity';
          const color = isSpike ? 'var(--sev-red)' : 'var(--sev-amber)';
          const label = isSpike ? country : `${country} · ${a.type.replace('-', ' ')}`;
          const delta = isSpike
            ? (a.zScore === Infinity ? '∞' : `${a.zScore.toFixed(1)}σ`)
            : (a.type === 'anomalous-silence' ? 'QUIET' : a.type === 'blind-spot' ? 'GAP' : 'LIMITED');
          const fakeSpark = Array.from({ length: 8 }, (_, j) => (isSpike ? 2 + j + Math.random() * 3 : 4 - Math.abs(4 - j)));
          return (
            <div
              key={`${a.iso}-${i}`}
              className="anomaly-row"
              role="button"
              tabIndex={0}
              aria-label={`${label} · ${delta}`}
              onClick={() => onRegionSelect?.(a.iso)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRegionSelect?.(a.iso); }
              }}
            >
              <Sparkline data={fakeSpark} color={color} />
              <div>
                <div className="anomaly-label">{label}</div>
                <div className="anomaly-sub">vs 14d baseline</div>
              </div>
              <div className="anomaly-delta">{delta}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AnomalyPanel;
