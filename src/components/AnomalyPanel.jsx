import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, VolumeX, TrendingUp, Zap, X } from 'lucide-react';
import { isoToCountry } from '../utils/geocoder.js';
import { buildAnomalyList, getAnomalySeverity } from '../utils/anomalyUtils.js';

/**
 * AnomalyPanel — sidebar/panel showing current anomalies:
 * velocity spikes (with z-scores and levels) and silence detection results.
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

  const spikeCount = anomalies.filter((a) => a.category === 'velocity').length;
  const silenceCount = anomalies.filter((a) => a.category === 'silence').length;

  if (!isOpen) return null;

  return (
    <div className="anomaly-panel" role="complementary" aria-label={t('anomaly.title')}>
      {/* Header */}
      <div className="anomaly-panel-header">
        <div className="anomaly-panel-title-row">
          <AlertTriangle size={16} className="anomaly-panel-icon" />
          <h2 className="anomaly-panel-title">{t('anomaly.title')}</h2>
          <button
            className="anomaly-panel-close"
            onClick={onClose}
            aria-label={t('panel.closePanel')}
          >
            <X size={14} />
          </button>
        </div>
        <div className="anomaly-panel-summary">
          {spikeCount > 0 && (
            <span className="anomaly-panel-badge anomaly-panel-badge--spike">
              <Zap size={10} />
              {spikeCount} {t('anomaly.spikes')}
            </span>
          )}
          {silenceCount > 0 && (
            <span className="anomaly-panel-badge anomaly-panel-badge--silence">
              <VolumeX size={10} />
              {silenceCount} {t('anomaly.silences')}
            </span>
          )}
          {anomalies.length === 0 && (
            <span className="anomaly-panel-badge anomaly-panel-badge--clear">
              {t('anomaly.noAnomalies')}
            </span>
          )}
        </div>
      </div>

      {/* Anomaly list */}
      <div className="anomaly-panel-body">
        {anomalies.length === 0 ? (
          <div className="anomaly-panel-empty">
            <TrendingUp size={24} />
            <p>{t('anomaly.noAnomalies')}</p>
          </div>
        ) : (
          <ul className="anomaly-panel-list">
            {/* Velocity spikes section */}
            {spikeCount > 0 && (
              <li className="anomaly-panel-section-header">
                <Zap size={12} />
                <span>{t('anomaly.velocitySpikes')}</span>
              </li>
            )}
            {anomalies
              .filter((a) => a.category === 'velocity')
              .map((anomaly) => {
                const sev = getAnomalySeverity(anomaly.type);
                const countryName = isoToCountry(anomaly.iso) || anomaly.iso;
                const zLabel = anomaly.zScore === Infinity ? '∞' : anomaly.zScore?.toFixed(1);

                return (
                  <li key={`v-${anomaly.iso}`} className="anomaly-panel-item">
                    <button
                      className={`anomaly-panel-btn anomaly-panel-btn--${anomaly.type}`}
                      onClick={() => onRegionSelect?.(anomaly.iso)}
                      aria-label={`${countryName}: ${sev.label}`}
                    >
                      <span
                        className="anomaly-panel-indicator"
                        style={{ background: sev.color }}
                      />
                      <div className="anomaly-panel-item-content">
                        <span className="anomaly-panel-region">{countryName}</span>
                        <span className="anomaly-panel-iso">{anomaly.iso}</span>
                      </div>
                      <div className="anomaly-panel-item-meta">
                        <span
                          className={`anomaly-panel-level anomaly-panel-level--${anomaly.type}`}
                        >
                          {t(`anomaly.level.${anomaly.type}`)}
                        </span>
                        {zLabel && (
                          <span className="anomaly-panel-zscore">z={zLabel}</span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}

            {/* Silence section */}
            {silenceCount > 0 && (
              <li className="anomaly-panel-section-header anomaly-panel-section-header--silence">
                <VolumeX size={12} />
                <span>{t('anomaly.silenceDetection')}</span>
              </li>
            )}
            {anomalies
              .filter((a) => a.category === 'silence')
              .map((anomaly) => {
                const sev = getAnomalySeverity(anomaly.type);
                const countryName = isoToCountry(anomaly.iso) || anomaly.iso;

                return (
                  <li key={`s-${anomaly.iso}`} className="anomaly-panel-item">
                    <button
                      className={`anomaly-panel-btn anomaly-panel-btn--silence`}
                      onClick={() => onRegionSelect?.(anomaly.iso)}
                      aria-label={`${countryName}: ${sev.label}`}
                    >
                      <span
                        className="anomaly-panel-indicator"
                        style={{ background: sev.color }}
                      />
                      <div className="anomaly-panel-item-content">
                        <span className="anomaly-panel-region">{countryName}</span>
                        <span className="anomaly-panel-iso">{anomaly.iso}</span>
                      </div>
                      <div className="anomaly-panel-item-meta">
                        <span className="anomaly-panel-level anomaly-panel-level--silence">
                          {t(`anomaly.status.${anomaly.type}`)}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default AnomalyPanel;
