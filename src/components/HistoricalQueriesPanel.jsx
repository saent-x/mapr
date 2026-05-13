import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, GitCompare, X, Layers, Columns2 } from 'lucide-react';
import useNewsStore from '../stores/newsStore';
import DateRangePicker from './DateRangePicker';
import TimeTravelScrubber from './TimeTravelScrubber';

/**
 * HistoricalQueriesPanel — wraps date range picker, comparison mode,
 * and time travel scrubber for historical snapshot queries.
 */
export default function HistoricalQueriesPanel({ onClose }) {
  const { t } = useTranslation();

  const availableTimestamps = useNewsStore((s) => s.availableTimestamps);
  const historicalState = useNewsStore((s) => s.historicalState);
  const comparisonMode = useNewsStore((s) => s.comparisonMode);
  const comparisonPeriods = useNewsStore((s) => s.comparisonPeriods);
  const isTimeTravel = useNewsStore((s) => s.isTimeTravel);
  const loadAvailableTimestamps = useNewsStore((s) => s.loadAvailableTimestamps);
  const loadHistoricalState = useNewsStore((s) => s.loadHistoricalState);
  const loadComparisonPeriods = useNewsStore((s) => s.loadComparisonPeriods);
  const setComparisonMode = useNewsStore((s) => s.setComparisonMode);
  const setTimeTravel = useNewsStore((s) => s.setTimeTravel);
  const exitHistoricalMode = useNewsStore((s) => s.exitHistoricalMode);

  const [mode, setMode] = useState('single'); // 'single' | 'compare' | 'timetravel'
  const [period1, setPeriod1] = useState(null);
  const [period2, setPeriod2] = useState(null);
  const [loading, setLoading] = useState(false);

  // Load available timestamps on mount
  useEffect(() => {
    loadAvailableTimestamps();
  }, [loadAvailableTimestamps]);

  // Handle single date range apply
  const handleSingleApply = useCallback(async ({ from, to }) => {
    setLoading(true);
    try {
      await loadHistoricalState(from, to);
      setPeriod1({ from, to });
      setMode('single');
    } finally {
      setLoading(false);
    }
  }, [loadHistoricalState]);

  // Handle comparison apply
  const handleCompareApply = useCallback(async (period, which) => {
    if (which === 'p1') setPeriod1(period);
    else setPeriod2(period);

    if ((which === 'p1' && period2) || (which === 'p2' && period1)) {
      const p1 = which === 'p1' ? period : period1;
      const p2 = which === 'p2' ? period : period2;
      if (p1 && p2) {
        setLoading(true);
        try {
          await loadComparisonPeriods(p1, p2);
        } finally {
          setLoading(false);
        }
      }
    }
  }, [period1, period2, loadComparisonPeriods]);

  // Handle time travel scrub
  const handleScrub = useCallback(async (timestamp) => {
    if (!timestamp) return;
    const d = new Date(timestamp);
    const from = new Date(d.getTime() - 60 * 60 * 1000).toISOString().slice(0, 10); // 1h before
    await loadHistoricalState(from, timestamp);
  }, [loadHistoricalState]);

  // Handle exit
  const handleExit = useCallback(() => {
    exitHistoricalMode();
    onClose?.();
  }, [exitHistoricalMode, onClose]);

  // Toggle comparison overlay mode
  const toggleOverlay = useCallback(() => {
    setComparisonMode(comparisonMode === 'overlay' ? null : 'overlay');
  }, [comparisonMode, setComparisonMode]);

  // Toggle comparison side-by-side mode
  const toggleSideBySide = useCallback(() => {
    setComparisonMode(comparisonMode === 'side-by-side' ? null : 'side-by-side');
  }, [comparisonMode, setComparisonMode]);

  return (
    <div className="mapr-historical-panel">
      {/* Header */}
      <div className="mapr-historical-header">
        <Clock size={16} />
        <span className="mapr-historical-title">{t('historicalQueries.title')}</span>
        <button className="mapr-historical-close" onClick={handleExit} type="button">
          <X size={16} />
        </button>
      </div>

      {/* Mode selector tabs */}
      <div className="mapr-historical-tabs">
        <button
          className={`mapr-historical-tab ${mode === 'single' ? 'active' : ''}`}
          onClick={() => setMode('single')}
          type="button"
        >
          {t('historicalQueries.singleRange')}
        </button>
        <button
          className={`mapr-historical-tab ${mode === 'compare' ? 'active' : ''}`}
          onClick={() => setMode('compare')}
          type="button"
        >
          <GitCompare size={12} />
          {t('historicalQueries.compareMode')}
        </button>
        <button
          className={`mapr-historical-tab ${mode === 'timetravel' ? 'active' : ''}`}
          onClick={() => { setMode('timetravel'); setTimeTravel(true); }}
          type="button"
        >
          {t('historicalQueries.timeTravelMode')}
        </button>
      </div>

      <div className="mapr-historical-body">
        {loading && (
          <div className="mapr-historical-loading">
            {t('historicalQueries.loading')}
          </div>
        )}

        {/* Single range mode */}
        {mode === 'single' && (
          <DateRangePicker
            onApply={handleSingleApply}
            onCancel={() => setPeriod1(null)}
            initialFrom={period1?.from}
            initialTo={period1?.to}
          />
        )}

        {/* Compare mode */}
        {mode === 'compare' && (
          <div className="mapr-historical-compare">
            <div className="mapr-compare-section">
              <h4 className="mapr-compare-label">{t('historicalQueries.period1')}</h4>
              <DateRangePicker
                onApply={(range) => handleCompareApply(range, 'p1')}
                onCancel={() => setPeriod1(null)}
                initialFrom={period1?.from}
                initialTo={period1?.to}
              />
            </div>
            <div className="mapr-compare-section">
              <h4 className="mapr-compare-label">{t('historicalQueries.period2')}</h4>
              <DateRangePicker
                onApply={(range) => handleCompareApply(range, 'p2')}
                onCancel={() => setPeriod2(null)}
                initialFrom={period2?.from}
                initialTo={period2?.to}
              />
            </div>

            {period1 && period2 && (
              <div className="mapr-compare-display-modes">
                <span className="mapr-compare-display-label">{t('historicalQueries.displayMode')}:</span>
                <button
                  className={`mapr-chip ${comparisonMode === 'overlay' ? 'active' : ''}`}
                  onClick={toggleOverlay}
                  type="button"
                >
                  <Layers size={12} />
                  {t('historicalQueries.overlay')}
                </button>
                <button
                  className={`mapr-chip ${comparisonMode === 'side-by-side' ? 'active' : ''}`}
                  onClick={toggleSideBySide}
                  type="button"
                >
                  <Columns2 size={12} />
                  {t('historicalQueries.sideBySide')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Time travel mode */}
        {mode === 'timetravel' && (
          <TimeTravelScrubber
            timestamps={availableTimestamps}
            onScrub={handleScrub}
            onClose={() => { setMode('single'); setTimeTravel(false); }}
            onPlayStateChange={(playing) => setTimeTravel(playing)}
          />
        )}

        {/* Historical state status */}
        {historicalState && !loading && (
          <div className="mapr-historical-status">
            <span className="mapr-status-dot" />
            {t('historicalQueries.viewingRange', {
              from: historicalState.from,
              to: historicalState.to,
            })}
          </div>
        )}

        {/* Exit historical mode button */}
        {historicalState && (
          <button className="mapr-btn mapr-btn-secondary mapr-historical-exit" onClick={handleExit} type="button">
            <X size={14} />
            {t('historicalQueries.returnToLive')}
          </button>
        )}
      </div>

      <style>{historicalPanelCSS}</style>
    </div>
  );
}

const historicalPanelCSS = `
  .mapr-historical-panel {
    background: var(--bg-0);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .mapr-historical-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
  }
  .mapr-historical-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex: 1;
  }
  .mapr-historical-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: none;
    color: var(--text-2);
    cursor: pointer;
    border-radius: 4px;
  }
  .mapr-historical-close:hover {
    color: var(--text-0);
    background: var(--bg-2);
  }
  .mapr-historical-tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
  }
  .mapr-historical-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 8px 4px;
    border: none;
    background: none;
    color: var(--text-2);
    font-size: 0.6875rem;
    font-weight: 600;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 2px solid transparent;
    transition: all 0.15s;
  }
  .mapr-historical-tab:hover {
    color: var(--text-1);
  }
  .mapr-historical-tab.active {
    color: var(--amber);
    border-bottom-color: var(--amber);
  }
  .mapr-historical-body {
    padding: 12px;
  }
  .mapr-historical-loading {
    text-align: center;
    padding: 20px;
    font-size: 0.75rem;
    color: var(--text-2);
  }
  .mapr-historical-compare {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .mapr-compare-section {}
  .mapr-compare-label {
    font-size: 0.6875rem;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 6px 0;
  }
  .mapr-compare-display-modes {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }
  .mapr-compare-display-label {
    font-size: 0.6875rem;
    color: var(--text-2);
    text-transform: uppercase;
  }
  .mapr-chip.active {
    border-color: var(--amber);
    color: var(--amber);
    background: color-mix(in srgb, var(--amber) 10%, transparent);
  }
  .mapr-historical-status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    padding: 8px 10px;
    background: color-mix(in srgb, var(--amber) 8%, transparent);
    border-radius: 4px;
    font-size: 0.6875rem;
    color: var(--amber);
    font-family: var(--ff-mono);
  }
  .mapr-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--amber);
    flex-shrink: 0;
  }
  .mapr-historical-exit {
    margin-top: 10px;
    width: 100%;
    justify-content: center;
  }
`;
