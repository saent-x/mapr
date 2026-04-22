import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { isoToCountry } from '../utils/geocoder.js';
import useUIStore from '../stores/uiStore.js';

/**
 * Build cluster summaries from the current event pool — group by category,
 * show the top title per cluster and the number of ISOs it has touched.
 * Lightweight stand-in for the design's "NARRATIVES" mini-panel.
 */
function buildClusters(newsList, limit = 5) {
  if (!newsList?.length) return [];
  const byCat = new Map();
  for (const s of newsList) {
    const cat = s.category || s.region || 'uncategorized';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(s);
  }
  const out = [];
  for (const [cat, list] of byCat.entries()) {
    const isos = new Set(list.map((x) => x.isoA2).filter(Boolean));
    const top = [...list].sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0))[0];
    out.push({
      id: `CL-${cat.slice(0, 4).toUpperCase()}`,
      title: top?.title || cat,
      sub: `${cat.toUpperCase()} · ${list.length} reports · ${isos.size} regions`,
      topIso: top?.isoA2 || null,
      count: list.length,
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out.slice(0, limit);
}

const NarrativePanel = ({ newsList = [], isOpen, onClose, onRegionSelect }) => {
  const { t } = useTranslation();
  const clusters = useMemo(() => buildClusters(newsList, isOpen ? 12 : 5), [newsList, isOpen]);

  const collapsed = useUIStore((s) => s.panelCollapsed.narrative);
  const togglePanelCollapsed = useUIStore((s) => s.togglePanelCollapsed);

  return (
    <div className="mini-panel" data-collapsed={collapsed || undefined} role="region" aria-label="Narratives">
      <div className="panel-header">
        <span className="dot" style={{ background: 'var(--cyan)' }} />
        NARRATIVES
        <span className="spacer" />
        <span style={{ color: 'var(--ink-2)' }}>CLUSTERS</span>
        <button
          type="button"
          className="panel-collapse-btn"
          onClick={() => togglePanelCollapsed('narrative')}
          aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronDown size={12} aria-hidden /> : <ChevronUp size={12} aria-hidden />}
        </button>
        {isOpen && (
          <button type="button" onClick={onClose} aria-label={t('panel.closePanel')}>×</button>
        )}
      </div>
      <div className="panel-body" style={isOpen ? { maxHeight: 'none' } : undefined} aria-hidden={collapsed || undefined}>
        {clusters.length === 0 && <div className="mini-panel-empty">NO CLUSTERS</div>}
        {clusters.map((n) => (
          <div
            key={n.id}
            className="narrative-row"
            role="button"
            tabIndex={0}
            aria-label={n.title}
            onClick={() => n.topIso && onRegionSelect?.(n.topIso)}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && n.topIso) {
                e.preventDefault();
                onRegionSelect?.(n.topIso);
              }
            }}
          >
            <div className="title">{n.title}</div>
            <div className="sub">
              {n.id} · {n.sub}
              {n.topIso ? ` · ${isoToCountry(n.topIso) || n.topIso}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default NarrativePanel;
