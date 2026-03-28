import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Shield, RefreshCw, Activity, Database, AlertTriangle,
  CheckCircle, XCircle, MinusCircle, Clock, Search, Globe, Rss,
  FileText, ChevronDown, ChevronUp, Loader, Lock,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const SESSION_KEY = 'mapr_admin_auth';

/* ── Status helpers ── */

const STATUS_ORDER = { ok: 0, empty: 1, failed: 2, 'never-checked': 3 };

function normalizeStatus(raw) {
  if (!raw) return 'unknown';
  const s = raw.toLowerCase();
  if (s === 'ok' || s === 'healthy' || s === 'operational') return 'ok';
  if (s === 'empty') return 'empty';
  if (s === 'failed' || s === 'error') return 'failed';
  if (s === 'never-checked') return 'never-checked';
  return 'unknown';
}

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const norm = normalizeStatus(status);
  const labels = { ok: t('admin.ok'), empty: t('admin.empty'), failed: t('admin.failed'), 'never-checked': t('admin.neverChecked'), unknown: t('admin.unknown') };
  const icons = { ok: CheckCircle, empty: MinusCircle, failed: XCircle, 'never-checked': Clock, unknown: Clock };
  const Icon = icons[norm] || Clock;
  return (
    <span className={`admin-status-badge admin-status-${norm}`}>
      <Icon size={12} />
      <span>{labels[norm] || norm}</span>
    </span>
  );
}

function FetchModeBadge({ mode }) {
  const isHtml = (mode || 'rss') === 'html';
  return (
    <span className={`admin-mode-badge admin-mode-${isHtml ? 'html' : 'rss'}`}>
      {isHtml ? <FileText size={11} /> : <Rss size={11} />}
      <span>{isHtml ? 'HTML' : 'RSS'}</span>
    </span>
  );
}

function formatTime(iso) {
  if (!iso) return null;
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return null;
  }
}

/* ── Stat card ── */

function StatCard({ label, value, color, icon: Icon }) {
  return (
    <div className="admin-stat-card">
      {Icon && <Icon size={14} className="admin-stat-icon" style={color ? { color } : undefined} />}
      <div className="admin-stat-content">
        <span className="admin-stat-value" style={color ? { color } : undefined}>{value}</span>
        <span className="admin-stat-label">{label}</span>
      </div>
    </div>
  );
}

/* ── Section wrapper ── */

function Section({ title, subtitle, icon: Icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="admin-section">
      <button className="admin-section-header" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="admin-section-title-row">
          {Icon && <Icon size={16} className="admin-section-icon" />}
          <div>
            <h2 className="admin-section-title">{title}</h2>
            {subtitle && <p className="admin-section-subtitle">{subtitle}</p>}
          </div>
        </div>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && <div className="admin-section-body">{children}</div>}
    </div>
  );
}

/* ── Password gate ── */

function PasswordGate({ onAuth }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setChecking(true);
    try {
      const res = await fetch(`/api/admin/verify?password=${encodeURIComponent(password.trim())}`);
      if (res.ok) {
        sessionStorage.setItem(SESSION_KEY, '1');
        onAuth();
      } else {
        setError(t('admin.wrongPassword'));
      }
    } catch {
      setError(t('admin.wrongPassword'));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="admin-password-gate">
        <Lock size={32} className="admin-password-icon" />
        <h1 className="admin-password-title">{t('admin.passwordRequired')}</h1>
        <form className="admin-password-form" onSubmit={handleSubmit}>
          <input
            type="password"
            className="admin-password-input"
            placeholder={t('admin.enterPassword')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <button type="submit" className="admin-password-submit" disabled={checking || !password.trim()}>
            {checking ? <Loader size={14} className="admin-spinner" /> : null}
            <span>{t('admin.submit')}</span>
          </button>
        </form>
        {error && <p className="admin-password-error">{error}</p>}
      </div>
    </div>
  );
}

/* ── Main component ── */

export default function AdminPage() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1');

  if (!authed) {
    return <PasswordGate onAuth={() => setAuthed(true)} />;
  }

  return <AdminDashboard />;
}

function AdminDashboard() {
  const { t } = useTranslation();
  const [catalogData, setCatalogData] = useState(null);
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  /* Filter/search state */
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalogRes, healthRes] = await Promise.all([
        fetch('/api/source-catalog/state'),
        fetch('/api/health'),
      ]);
      if (!catalogRes.ok) throw new Error(`Catalog: HTTP ${catalogRes.status}`);
      if (!healthRes.ok) throw new Error(`Health: HTTP ${healthRes.status}`);
      const [catalog, health] = await Promise.all([catalogRes.json(), healthRes.json()]);
      setCatalogData(catalog);
      setHealthData(health);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* Auto-refresh every 60s */
  useEffect(() => {
    const id = setInterval(fetchData, 60000);
    return () => clearInterval(id);
  }, [fetchData]);

  /* ── Derived data ── */

  const feeds = useMemo(() => catalogData?.feeds || [], [catalogData]);
  const summary = useMemo(() => catalogData?.summary || {}, [catalogData]);

  /* Also count from health API rss feeds for more up-to-date data */
  const rssHealth = healthData?.sourceHealth?.rss || {};

  /* Merge health API feed data with catalog feeds for best freshness */
  const mergedFeeds = useMemo(() => {
    const healthFeedMap = new Map();
    (rssHealth.feeds || []).forEach((f) => healthFeedMap.set(f.feedId, f));

    return feeds.map((feed) => {
      const hf = healthFeedMap.get(feed.id);
      if (!hf) return feed;
      return {
        ...feed,
        lastStatus: hf.status || feed.lastStatus,
        lastCheckedAt: hf.lastCheckedAt || feed.lastCheckedAt,
        lastArticleCount: hf.articleCount ?? feed.lastArticleCount,
        lastError: hf.error || feed.lastError,
      };
    });
  }, [feeds, rssHealth.feeds]);

  /* Count statuses from merged feeds (same data source as filteredFeeds) */
  const statusCounts = useMemo(() => {
    const counts = { ok: 0, empty: 0, failed: 0, 'never-checked': 0 };
    mergedFeeds.forEach((f) => {
      const norm = normalizeStatus(f.lastStatus);
      if (norm in counts) counts[norm]++;
    });
    return counts;
  }, [mergedFeeds]);

  const healthyCount = rssHealth.healthyFeeds ?? statusCounts.ok;
  const failedCount = rssHealth.failedFeeds ?? statusCounts.failed;
  const emptyCount = rssHealth.emptyFeeds ?? statusCounts.empty;

  /* Filter and sort feeds */
  const filteredFeeds = useMemo(() => {
    let result = mergedFeeds;
    if (statusFilter !== 'all') {
      result = result.filter((f) => normalizeStatus(f.lastStatus) === statusFilter);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q.length >= 2) {
      result = result.filter((f) =>
        (f.name || '').toLowerCase().includes(q) ||
        (f.country || '').toLowerCase().includes(q) ||
        (f.isoA2 || '').toLowerCase().includes(q) ||
        (f.id || '').toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case 'name': cmp = (a.name || '').localeCompare(b.name || ''); break;
        case 'status': cmp = (STATUS_ORDER[normalizeStatus(a.lastStatus)] ?? 9) - (STATUS_ORDER[normalizeStatus(b.lastStatus)] ?? 9); break;
        case 'articles': cmp = (a.lastArticleCount || 0) - (b.lastArticleCount || 0); break;
        case 'lastChecked': cmp = new Date(a.lastCheckedAt || 0) - new Date(b.lastCheckedAt || 0); break;
        default: break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return result;
  }, [mergedFeeds, statusFilter, searchQuery, sortCol, sortDir]);

  /* Coverage gaps from health API */
  const coverageDiagnostics = healthData?.coverageDiagnostics || {};
  const coverageMetrics = healthData?.coverageMetrics || {};

  /* Ingestion health */
  const lastAttemptAt = healthData?.lastAttemptAt || null;
  const lastSuccessAt = healthData?.lastSuccessAt || null;
  const consecutiveFailures = healthData?.consecutiveFailures ?? 0;
  const refreshInProgress = healthData?.refreshInProgress || false;
  const pipelineStatus = healthData?.status || 'unknown';

  const handleSort = useCallback((col) => {
    setSortCol((prev) => {
      if (prev === col) { setSortDir((d) => d === 'asc' ? 'desc' : 'asc'); return col; }
      setSortDir('asc');
      return col;
    });
  }, []);

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return null;
    return sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />;
  };

  /* ── Loading state ── */
  if (loading && !catalogData) {
    return (
      <div className="admin-page">
        <div className="admin-loading">
          <Loader size={24} className="admin-spinner" />
          <span>{t('admin.loading')}</span>
        </div>
      </div>
    );
  }

  /* ── Error state ── */
  if (error && !catalogData) {
    return (
      <div className="admin-page">
        <div className="admin-error">
          <AlertTriangle size={24} />
          <span>{t('admin.error')}</span>
          <p className="admin-error-detail">{error}</p>
          <button className="admin-retry-btn" onClick={fetchData}>{t('admin.retry')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      {/* Header */}
      <div className="admin-header">
        <div className="admin-header-left">
          <Shield size={20} className="admin-header-icon" />
          <div>
            <h1 className="admin-title">{t('admin.title')}</h1>
            <p className="admin-subtitle">{t('admin.subtitle')}</p>
          </div>
        </div>
        <div className="admin-header-right">
          {lastRefresh && (
            <span className="admin-updated">{t('admin.lastUpdated', { time: lastRefresh.toLocaleTimeString() })}</span>
          )}
          <button className="admin-refresh-btn" onClick={fetchData} disabled={loading} aria-label={t('admin.refresh')}>
            <RefreshCw size={14} className={loading ? 'admin-spinner' : ''} />
            <span>{t('admin.refresh')}</span>
          </button>
        </div>
      </div>

      {/* Aggregate Stats */}
      <Section title={t('admin.aggregateStats')} icon={Database} defaultOpen={true}>
        <div className="admin-stat-grid">
          <StatCard label={t('admin.totalSources')} value={summary.totalSources || feeds.length} icon={Database} />
          <StatCard label={t('admin.healthySources')} value={healthyCount} color="var(--low)" icon={CheckCircle} />
          <StatCard label={t('admin.failedSources')} value={failedCount} color={failedCount > 0 ? 'var(--critical)' : 'var(--low)'} icon={XCircle} />
          <StatCard label={t('admin.emptySources')} value={emptyCount} color={emptyCount > 0 ? 'var(--watch)' : 'var(--low)'} icon={MinusCircle} />
          <StatCard label={t('admin.localSources')} value={summary.localSources || 0} icon={Globe} />
          <StatCard label={t('admin.regionalSources')} value={summary.regionalSources || 0} icon={Globe} />
          <StatCard label={t('admin.globalSources')} value={summary.globalSources || 0} icon={Globe} />
          <StatCard label={t('admin.officialSources')} value={summary.officialSources || 0} icon={Shield} />
          <StatCard label={t('admin.htmlSources')} value={summary.htmlSources || 0} icon={FileText} />
        </div>
      </Section>

      {/* Ingestion Health */}
      <Section title={t('admin.ingestionHealth')} subtitle={t('admin.ingestionHealthDesc')} icon={Activity} defaultOpen={true}>
        <div className="admin-stat-grid">
          <StatCard
            label={t('admin.pipelineStatus')}
            value={pipelineStatus.toUpperCase()}
            color={pipelineStatus === 'healthy' ? 'var(--low)' : 'var(--critical)'}
            icon={Activity}
          />
          <StatCard
            label={t('admin.lastAttempt')}
            value={formatTime(lastAttemptAt) || t('admin.never')}
            icon={Clock}
          />
          <StatCard
            label={t('admin.lastSuccess')}
            value={formatTime(lastSuccessAt) || t('admin.never')}
            color={lastSuccessAt ? 'var(--low)' : 'var(--watch)'}
            icon={CheckCircle}
          />
          <StatCard
            label={t('admin.consecutiveFailures')}
            value={consecutiveFailures}
            color={consecutiveFailures > 0 ? 'var(--critical)' : 'var(--low)'}
            icon={consecutiveFailures > 0 ? AlertTriangle : CheckCircle}
          />
        </div>
        {refreshInProgress && (
          <div className="admin-ingest-active">
            <Loader size={14} className="admin-spinner" />
            <span>{t('admin.refreshInProgress')}</span>
          </div>
        )}
      </Section>

      {/* Coverage Gaps */}
      <Section title={t('admin.coverageGaps')} subtitle={t('admin.coverageGapsDesc')} icon={Globe} defaultOpen={true}>
        {(coverageDiagnostics.lowConfidenceRegions?.length > 0 ||
          coverageDiagnostics.ingestionRiskRegions?.length > 0 ||
          coverageDiagnostics.sourceSparseRegions?.length > 0) ? (
          <div className="admin-coverage-gaps">
            {coverageDiagnostics.ingestionRiskRegions?.length > 0 && (
              <div className="admin-gap-group">
                <h3 className="admin-gap-label admin-gap-critical">
                  <AlertTriangle size={12} /> {t('admin.ingestionRisk')}
                </h3>
                {coverageDiagnostics.ingestionRiskRegions.map((r) => (
                  <div key={r.iso} className="admin-gap-item">
                    <span className="admin-gap-region">{r.region || r.iso}</span>
                    <span className="admin-gap-detail">{r.failedFeeds}/{r.feedCount} {t('admin.failedSources').toLowerCase()}</span>
                  </div>
                ))}
              </div>
            )}
            {coverageDiagnostics.lowConfidenceRegions?.length > 0 && (
              <div className="admin-gap-group">
                <h3 className="admin-gap-label admin-gap-warning">
                  <MinusCircle size={12} /> {t('admin.lowConfidence')}
                </h3>
                {coverageDiagnostics.lowConfidenceRegions.map((r) => (
                  <div key={r.iso} className="admin-gap-item">
                    <span className="admin-gap-region">{r.region || r.iso}</span>
                    <span className="admin-gap-detail">{r.maxConfidence}%</span>
                  </div>
                ))}
              </div>
            )}
            {coverageDiagnostics.sourceSparseRegions?.length > 0 && (
              <div className="admin-gap-group">
                <h3 className="admin-gap-label admin-gap-sparse">
                  <Globe size={12} /> {t('admin.sourceSparse')}
                </h3>
                {coverageDiagnostics.sourceSparseRegions.map((r) => (
                  <div key={r.iso} className="admin-gap-item">
                    <span className="admin-gap-region">{r.region || r.iso}</span>
                    <span className="admin-gap-detail">{t('admin.feedCount', { count: r.feedCount || 0 })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="admin-no-gaps">{t('admin.noCoverageGaps')}</p>
        )}
      </Section>

      {/* Source Health Table */}
      <Section title={t('admin.sourceHealth')} subtitle={t('admin.sourceHealthDesc')} icon={Rss} defaultOpen={true}>
        {/* Filters */}
        <div className="admin-table-controls">
          <div className="admin-search-wrapper">
            <Search size={14} className="admin-search-icon" />
            <input
              type="text"
              className="admin-search-input"
              placeholder={t('admin.search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="admin-filter-tabs">
            {['all', 'ok', 'empty', 'failed'].map((key) => (
              <button
                key={key}
                className={`admin-filter-tab ${statusFilter === key ? 'is-active' : ''}`}
                onClick={() => setStatusFilter(key)}
              >
                {key === 'all' ? t('admin.showAll') : t(`admin.${key}`)}
                {key !== 'all' && <span className="admin-filter-count">{statusCounts[key] || 0}</span>}
              </button>
            ))}
          </div>
        </div>

        {filteredFeeds.length === 0 ? (
          <p className="admin-no-sources">{t('admin.noSources')}</p>
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="admin-th admin-th-sortable" onClick={() => handleSort('name')}>
                    {t('admin.name')} <SortIcon col="name" />
                  </th>
                  <th className="admin-th admin-th-sortable" onClick={() => handleSort('status')}>
                    {t('admin.status')} <SortIcon col="status" />
                  </th>
                  <th className="admin-th">{t('admin.type')}</th>
                  <th className="admin-th">{t('admin.fetchMode')}</th>
                  <th className="admin-th admin-th-sortable" onClick={() => handleSort('lastChecked')}>
                    {t('admin.lastChecked')} <SortIcon col="lastChecked" />
                  </th>
                  <th className="admin-th admin-th-sortable admin-th-right" onClick={() => handleSort('articles')}>
                    {t('admin.articleCount')} <SortIcon col="articles" />
                  </th>
                  <th className="admin-th">{t('admin.country')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredFeeds.map((feed) => (
                  <tr key={feed.id} className="admin-tr">
                    <td className="admin-td admin-td-name" title={feed.url}>{feed.name || feed.id}</td>
                    <td className="admin-td"><StatusBadge status={feed.lastStatus} /></td>
                    <td className="admin-td">
                      <span className="admin-source-type">{feed.sourceClass || feed.sourceType || '—'}</span>
                    </td>
                    <td className="admin-td"><FetchModeBadge mode={feed.fetchMode} /></td>
                    <td className="admin-td admin-td-time">{formatTime(feed.lastCheckedAt) || t('admin.never')}</td>
                    <td className="admin-td admin-td-right">{feed.lastArticleCount ?? 0}</td>
                    <td className="admin-td admin-td-country">{feed.country || feed.isoA2 || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="admin-table-footer">
          <span className="admin-table-showing">
            {filteredFeeds.length} / {mergedFeeds.length} sources
          </span>
        </div>
      </Section>
    </div>
  );
}
