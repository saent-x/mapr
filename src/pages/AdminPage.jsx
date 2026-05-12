import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Shield, RefreshCw, Activity, Database, AlertTriangle,
  CheckCircle, XCircle, MinusCircle, Clock, Search, Globe, Rss,
  FileText, ChevronDown, ChevronUp, Loader, Lock, ShieldCheck,
  TrendingUp, TrendingDown, Minus,
  Plus, Edit, Trash2, Upload, Download, Power, PowerOff,
  Sliders, ArrowLeft,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { getLocale } from '../utils/formatDate.js';
import { buildSourceAddPayload } from '../utils/adminSourcePayload.js';
import useKeyboardNavigation from '../hooks/useKeyboardNavigation';
import BrandMark from '../components/BrandMark.jsx';
import {
  FEATURE_ACCESS_CATALOG,
  FEATURE_TIER_DISABLED,
  FEATURE_TIER_FREE,
  FEATURE_TIER_PRO,
  normalizeFeatureFlags,
} from '../utils/featureAccess.js';

/* ── Status helpers ── */

const ADMIN_PAGE_SIZE = 12;
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

async function readJsonIfOk(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.includes('application/json')) return null;
  return response.json();
}

async function readAdminJson(response, label = 'Admin API') {
  const contentType = response.headers.get('content-type') || '';
  let payload = null;

  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      throw new Error(`${label}: invalid JSON response`);
    }
  }

  if (!response.ok) {
    throw new Error(payload?.error || `${label}: HTTP ${response.status}`);
  }

  if (!contentType.includes('application/json')) {
    throw new Error(`${label}: expected JSON but received ${contentType || 'unknown response'}`);
  }

  return payload;
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

function AdminPagination({ page, total, pageSize = ADMIN_PAGE_SIZE, onPageChange, label }) {
  const { t } = useTranslation();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const start = total === 0 ? 0 : ((safePage - 1) * pageSize) + 1;
  const end = Math.min(total, safePage * pageSize);

  if (pageCount <= 1) {
    return (
      <div className="admin-pagination admin-pagination-static">
        <span>{label || t('admin.showingRows', { start, end, total })}</span>
      </div>
    );
  }

  return (
    <div className="admin-pagination">
      <span>{label || t('admin.showingRows', { start, end, total })}</span>
      <div className="admin-pagination-controls">
        <button
          type="button"
          className="admin-page-btn"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1}
        >
          {t('admin.previous', 'Previous')}
        </button>
        <span className="admin-page-current">
          {safePage} / {pageCount}
        </span>
        <button
          type="button"
          className="admin-page-btn"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= pageCount}
        >
          {t('admin.next', 'Next')}
        </button>
      </div>
    </div>
  );
}

/* ── Password gate ── */

function PasswordGate({ onAuth }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setChecking(true);
    try {
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim() }),
      });
      if (res.ok) {
        onAuth();
      } else if (res.status === 503) {
        setError(t('admin.wrongPassword'));
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
        <button type="button" className="admin-password-back-link" onClick={() => navigate('/')}>
          <ArrowLeft size={13} aria-hidden />
          <span>{t('admin.backToMap', 'Back to map')}</span>
        </button>
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
  const [authed, setAuthed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/admin/session', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) setAuthed(true);
      })
      .catch(() => {});
  }, []);

  /* ── Keyboard navigation (basic: ? for help, Escape to go back, / for search) ── */
  useKeyboardNavigation({
    items: [],
    searchSelector: '.search-input, .header-search input',
    onEscape: useCallback(() => {
      navigate('/');
      return true;
    }, [navigate]),
    onHelp: useCallback(() => {
      window.dispatchEvent(new CustomEvent('mapr:openShortcutHelp'));
    }, []),
  });

  if (!authed) {
    return <PasswordGate onAuth={() => setAuthed(true)} />;
  }

  return <AdminDashboard />;
}

function AdminDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('overview');
  const [catalogData, setCatalogData] = useState(null);
  const [healthData, setHealthData] = useState(null);
  const [reliabilityData, setReliabilityData] = useState(null);
  const [featureFlags, setFeatureFlags] = useState(() => normalizeFeatureFlags());
  const [reliabilitySortCol, setReliabilitySortCol] = useState('score');
  const [reliabilitySortDir, setReliabilitySortDir] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  /* ── Source management state ── */
  const [showAddForm, setShowAddForm] = useState(false);
  const [addFormType, setAddFormType] = useState('rss'); // 'rss' or 'gdelt'
  const [addForm, setAddForm] = useState({ name: '', url: '', country: '', sourceType: '', fetchMode: 'rss', gdeltQuery: '', notes: '' });
  const [editingSource, setEditingSource] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', url: '', country: '', sourceType: '', notes: '' });
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importFile, setImportFile] = useState(null);
  const [importError, setImportError] = useState('');
  const [sourceActionError, setSourceActionError] = useState('');
  const [sourceActionOk, setSourceActionOk] = useState('');
  const [featureActionError, setFeatureActionError] = useState('');
  const [featureActionOk, setFeatureActionOk] = useState('');
  const [savingFeatureFlags, setSavingFeatureFlags] = useState(false);

  /* Filter/search state */
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [manageSearchQuery, setManageSearchQuery] = useState('');
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [sourceHealthPage, setSourceHealthPage] = useState(1);
  const [sourceManagePage, setSourceManagePage] = useState(1);
  const [reliabilityPage, setReliabilityPage] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalogRes, healthRes, reliabilityRes, featureFlagsRes] = await Promise.all([
        fetch('/api/source-catalog/state'),
        fetch('/api/health'),
        fetch('/api/source-reliability'),
        fetch('/api/admin/feature-flags', { credentials: 'include' }),
      ]);
      if (!catalogRes.ok) throw new Error(`Catalog: HTTP ${catalogRes.status}`);
      if (!healthRes.ok) throw new Error(`Health: HTTP ${healthRes.status}`);
      const [catalog, health, reliability] = await Promise.all([
        catalogRes.json(),
        healthRes.json(),
        readJsonIfOk(reliabilityRes),
      ]);
      const flags = await readAdminJson(featureFlagsRes, 'Feature access');
      setCatalogData(catalog);
      setHealthData(health);
      if (reliability) setReliabilityData(reliability);
      if (flags) setFeatureFlags(normalizeFeatureFlags(flags));
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

  const filteredManageFeeds = useMemo(() => {
    const q = manageSearchQuery.trim().toLowerCase();
    if (q.length < 2) return mergedFeeds;
    return mergedFeeds.filter((f) =>
      (f.name || '').toLowerCase().includes(q) ||
      (f.country || '').toLowerCase().includes(q) ||
      (f.isoA2 || '').toLowerCase().includes(q) ||
      (f.id || '').toLowerCase().includes(q) ||
      (f.url || '').toLowerCase().includes(q)
    );
  }, [mergedFeeds, manageSearchQuery]);

  useEffect(() => {
    setSourceHealthPage(1);
  }, [statusFilter, searchQuery, sortCol, sortDir]);

  useEffect(() => {
    setSourceManagePage(1);
  }, [manageSearchQuery]);

  useEffect(() => {
    setReliabilityPage(1);
  }, [reliabilitySortCol, reliabilitySortDir, reliabilityData]);

  const paginatedFilteredFeeds = useMemo(() => {
    const start = (sourceHealthPage - 1) * ADMIN_PAGE_SIZE;
    return filteredFeeds.slice(start, start + ADMIN_PAGE_SIZE);
  }, [filteredFeeds, sourceHealthPage]);

  const paginatedManageFeeds = useMemo(() => {
    const start = (sourceManagePage - 1) * ADMIN_PAGE_SIZE;
    return filteredManageFeeds.slice(start, start + ADMIN_PAGE_SIZE);
  }, [filteredManageFeeds, sourceManagePage]);

  /* Coverage gaps from health API */
  const coverageDiagnostics = healthData?.coverageDiagnostics || {};
  const coverageMetrics = healthData?.coverageMetrics || {};

  /* Ingestion health */
  const lastAttemptAt = healthData?.lastAttemptAt || null;
  const lastSuccessAt = healthData?.lastSuccessAt || null;
  const consecutiveFailures = healthData?.consecutiveFailures ?? 0;
  const refreshInProgress = healthData?.refreshInProgress || false;
  const pipelineStatus = healthData?.status || 'unknown';

  const adminNavItems = useMemo(() => ([
    { id: 'overview', label: t('admin.overview', 'Overview'), icon: Database, count: summary.totalSources || feeds.length },
    { id: 'coverage', label: t('admin.coverage', 'Coverage'), icon: Globe, count: coverageMetrics.lowConfidenceCount || null },
    { id: 'sources', label: t('admin.sources', 'Sources'), icon: Rss, count: mergedFeeds.length },
    { id: 'manage', label: t('admin.manage', 'Manage'), icon: Sliders, count: filteredManageFeeds.length },
    { id: 'features', label: t('admin.features', 'Features'), icon: Shield, count: FEATURE_ACCESS_CATALOG.length },
    { id: 'reliability', label: t('admin.reliability', 'Reliability'), icon: ShieldCheck, count: reliabilityData?.length || null },
  ]), [t, summary.totalSources, feeds.length, coverageMetrics.lowConfidenceCount, mergedFeeds.length, filteredManageFeeds.length, reliabilityData]);

  const activeNavItem = adminNavItems.find((item) => item.id === activeSection) || adminNavItems[0];

  const sortedReliability = useMemo(() => {
    if (!reliabilityData) return [];
    return [...reliabilityData].sort((a, b) => {
      let cmp = 0;
      switch (reliabilitySortCol) {
        case 'sourceKey': cmp = (a.sourceKey || '').localeCompare(b.sourceKey || ''); break;
        case 'score': cmp = (a.score || 0) - (b.score || 0); break;
        case 'totalEvents': cmp = (a.totalEvents || 0) - (b.totalEvents || 0); break;
        case 'corroboratedEvents': cmp = (a.corroboratedEvents || 0) - (b.corroboratedEvents || 0); break;
        case 'lastUpdatedAt': cmp = new Date(a.lastUpdatedAt || 0) - new Date(b.lastUpdatedAt || 0); break;
        default: break;
      }
      return reliabilitySortDir === 'desc' ? -cmp : cmp;
    });
  }, [reliabilityData, reliabilitySortCol, reliabilitySortDir]);

  const paginatedReliabilityData = useMemo(() => {
    const start = (reliabilityPage - 1) * ADMIN_PAGE_SIZE;
    return sortedReliability.slice(start, start + ADMIN_PAGE_SIZE);
  }, [sortedReliability, reliabilityPage]);

  const handleReliabilitySort = useCallback((col) => {
    setReliabilitySortCol((prev) => {
      if (prev === col) { setReliabilitySortDir((d) => d === 'asc' ? 'desc' : 'asc'); return col; }
      setReliabilitySortDir('desc');
      return col;
    });
  }, []);

  const ReliabilitySortIcon = ({ col }) => {
    if (reliabilitySortCol !== col) return null;
    return reliabilitySortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />;
  };

  const getScoreColor = (score) => {
    if (score >= 0.7) return 'var(--sev-green)';
    if (score >= 0.4) return 'var(--sev-amber)';
    return 'var(--sev-red)';
  };

  const getScoreLabel = (score) => {
    if (score >= 0.7) return t('admin.reliabilityHigh');
    if (score >= 0.4) return t('admin.reliabilityMedium');
    return t('admin.reliabilityLow');
  };

  const getTrendIcon = (score) => {
    if (score >= 0.7) return <TrendingUp size={12} color="var(--sev-green)" />;
    if (score >= 0.4) return <Minus size={12} color="var(--sev-amber)" />;
    return <TrendingDown size={12} color="var(--sev-red)" />;
  };

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

  /* ── Source management handlers ── */

  const clearSourceMessages = useCallback(() => {
    setSourceActionError('');
    setSourceActionOk('');
  }, []);

  const handleAddSource = useCallback(async (e) => {
    e.preventDefault();
    clearSourceMessages();
    const payload = buildSourceAddPayload(addForm, addFormType);
    try {
      const res = await fetch('/api/source-catalog/add', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setSourceActionOk(t('admin.sourceAdded'));
      setShowAddForm(false);
      setAddForm({ name: '', url: '', country: '', sourceType: '', fetchMode: 'rss', gdeltQuery: '', notes: '' });
      fetchData();
    } catch (err) {
      setSourceActionError(err.message);
    }
  }, [addForm, addFormType, clearSourceMessages, fetchData, t]);

  const handleEditClick = useCallback((source) => {
    setEditingSource(source.id);
    setEditForm({
      name: source.name || '',
      url: source.url || '',
      country: source.country || '',
      sourceType: source.sourceType || '',
      notes: source.notes || '',
    });
    clearSourceMessages();
  }, [clearSourceMessages]);

  const handleEditSave = useCallback(async (e) => {
    e.preventDefault();
    clearSourceMessages();
    if (!editingSource) return;
    try {
      const res = await fetch(`/api/source-catalog/${editingSource}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setSourceActionOk(t('admin.sourceUpdated'));
      setEditingSource(null);
      setEditForm({ name: '', url: '', country: '', sourceType: '', notes: '' });
      fetchData();
    } catch (err) {
      setSourceActionError(err.message);
    }
  }, [editingSource, editForm, clearSourceMessages, fetchData, t]);

  const handleDeleteSource = useCallback(async (id) => {
    if (!window.confirm(t('admin.confirmDelete'))) return;
    clearSourceMessages();
    try {
      const res = await fetch(`/api/source-catalog/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setSourceActionOk(t('admin.sourceDeleted'));
      fetchData();
    } catch (err) {
      setSourceActionError(err.message);
    }
  }, [clearSourceMessages, fetchData, t]);

  const handleReEnable = useCallback(async (id) => {
    clearSourceMessages();
    try {
      const res = await fetch('/api/source-catalog/re-enable', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setSourceActionOk(t('admin.sourceReEnabled'));
      fetchData();
    } catch (err) {
      setSourceActionError(err.message);
    }
  }, [clearSourceMessages, fetchData, t]);

  const handleImportJson = useCallback(async (e) => {
    e.preventDefault();
    clearSourceMessages();
    setImportError('');
    let feeds;
    try {
      feeds = JSON.parse(importJson);
    } catch {
      setImportError(t('admin.invalidJson'));
      return;
    }
    if (!Array.isArray(feeds) || feeds.length === 0) {
      setImportError(t('admin.importEmptyArray'));
      return;
    }
    try {
      const res = await fetch('/api/source-catalog/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feeds }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const d = await res.json();
      setSourceActionOk(t('admin.importSuccess', { count: d.addedCount || feeds.length }));
      setShowImport(false);
      setImportJson('');
      setImportFile(null);
      fetchData();
    } catch (err) {
      setSourceActionError(err.message);
    }
  }, [importJson, clearSourceMessages, fetchData, t]);

  const handleImportFile = useCallback(async (e) => {
    e.preventDefault();
    clearSourceMessages();
    setImportError('');
    if (!importFile) {
      setImportError(t('admin.noFileSelected'));
      return;
    }
    try {
      const text = await importFile.text();
      let feeds;
      try {
        feeds = JSON.parse(text);
      } catch {
        setImportError(t('admin.invalidJsonFile'));
        return;
      }
      if (!Array.isArray(feeds) || feeds.length === 0) {
        setImportError(t('admin.importEmptyArray'));
        return;
      }
      const res = await fetch('/api/source-catalog/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feeds }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const d = await res.json();
      setSourceActionOk(t('admin.importSuccess', { count: d.addedCount || feeds.length }));
      setShowImport(false);
      setImportJson('');
      setImportFile(null);
      fetchData();
    } catch (err) {
      setSourceActionError(err.message);
    }
  }, [importFile, clearSourceMessages, fetchData, t]);

  const handleExport = useCallback(async () => {
    clearSourceMessages();
    try {
      const res = await fetch('/api/source-catalog/export', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'source-catalog-export.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSourceActionOk(t('admin.exportSuccess'));
    } catch (err) {
      setSourceActionError(err.message);
    }
  }, [clearSourceMessages, t]);

  const saveFeatureFlags = useCallback(async (nextFlags) => {
    setSavingFeatureFlags(true);
    setFeatureActionError('');
    setFeatureActionOk('');
    try {
      const res = await fetch('/api/admin/feature-flags', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextFlags),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const saved = normalizeFeatureFlags(await readAdminJson(res, 'Feature access'));
      setFeatureFlags(saved);
      setFeatureActionOk(t('admin.featuresSaved', 'Feature access updated'));
    } catch (err) {
      setFeatureActionError(err.message);
    } finally {
      setSavingFeatureFlags(false);
    }
  }, [t]);

  const handleBillingToggle = useCallback(() => {
    saveFeatureFlags({
      ...featureFlags,
      billingEnabled: !featureFlags.billingEnabled,
    });
  }, [featureFlags, saveFeatureFlags]);

  const handleFeatureTierChange = useCallback((featureId, tier) => {
    saveFeatureFlags({
      ...featureFlags,
      features: {
        ...featureFlags.features,
        [featureId]: tier,
      },
    });
  }, [featureFlags, saveFeatureFlags]);

  const handleBulkFeatureTier = useCallback((tier) => {
    saveFeatureFlags({
      ...featureFlags,
      features: Object.fromEntries(FEATURE_ACCESS_CATALOG.map((feature) => [feature.id, tier])),
    });
  }, [featureFlags, saveFeatureFlags]);

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
    <div className="admin-page admin-shell-page">
      <aside className="admin-sidebar" aria-label={t('admin.navigation', 'Admin navigation')}>
        <div className="admin-sidebar-brand">
          <BrandMark className="layout-mapr-nav-icon" size={18} />
          <span className="side-label">{t('admin.console', 'Admin console')}</span>
        </div>
        <nav className="admin-sidebar-nav">
          {adminNavItems.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              type="button"
              className={`admin-nav-item ${activeSection === id ? 'is-active' : ''}`}
              onClick={() => setActiveSection(id)}
              aria-current={activeSection === id ? 'page' : undefined}
            >
              <Icon size={15} aria-hidden />
              <span>{label}</span>
              {count != null && <em>{count}</em>}
            </button>
          ))}
        </nav>
        <button type="button" className="admin-back-link" onClick={() => navigate('/')}>
          <ArrowLeft size={14} aria-hidden />
          <span>{t('admin.backToMap', 'Back to map')}</span>
        </button>
      </aside>

      <main className="admin-main">
        {/* Header */}
        <div className="admin-header">
          <div className="admin-header-left">
            <div>
              <p className="admin-current-section">{activeNavItem?.label}</p>
              <h1 className="admin-title">{t('admin.title')}</h1>
              <p className="admin-subtitle">{t('admin.subtitle')}</p>
            </div>
          </div>
          <div className="admin-header-right">
            {lastRefresh && (
              <span className="admin-updated">{t('admin.lastUpdated', { time: lastRefresh instanceof Date ? lastRefresh.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : new Date(lastRefresh).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })}</span>
            )}
            <button className="admin-refresh-btn" onClick={fetchData} disabled={loading} aria-label={t('admin.refresh')}>
              <RefreshCw size={14} className={loading ? 'admin-spinner' : ''} />
              <span>{t('admin.refresh')}</span>
            </button>
          </div>
        </div>

      {/* Aggregate Stats */}
      {activeSection === 'overview' && <Section title={t('admin.aggregateStats')} icon={Database} defaultOpen={true}>
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
        <div className="admin-overview-pipeline">
          <div className="admin-overview-pipeline-head">
            <Activity size={15} aria-hidden />
            <div>
              <h3>{t('admin.ingestionHealth')}</h3>
              <p>{t('admin.ingestionHealthDesc')}</p>
            </div>
          </div>
          <div className="admin-stat-grid admin-stat-grid-compact">
            <StatCard
              label={t('admin.pipelineStatus')}
              value={pipelineStatus.toUpperCase()}
              color={pipelineStatus === 'healthy' ? 'var(--low)' : 'var(--critical)'}
              icon={Activity}
            />
            <StatCard label={t('admin.lastAttempt')} value={formatTime(lastAttemptAt) || t('admin.never')} icon={Clock} />
            <StatCard label={t('admin.lastSuccess')} value={formatTime(lastSuccessAt) || t('admin.never')} color={lastSuccessAt ? 'var(--low)' : 'var(--watch)'} icon={CheckCircle} />
            <StatCard label={t('admin.consecutiveFailures')} value={consecutiveFailures} color={consecutiveFailures > 0 ? 'var(--critical)' : 'var(--low)'} icon={consecutiveFailures > 0 ? AlertTriangle : CheckCircle} />
          </div>
          {refreshInProgress && (
            <div className="admin-ingest-active">
              <Loader size={14} className="admin-spinner" />
              <span>{t('admin.refreshInProgress')}</span>
            </div>
          )}
        </div>
      </Section>}

      {/* Coverage Gaps */}
      {activeSection === 'coverage' && <Section title={t('admin.coverageGaps')} subtitle={t('admin.coverageGapsDesc')} icon={Globe} defaultOpen={true}>
        <div className="admin-coverage-summary">
          <StatCard label={t('admin.lowConfidence')} value={coverageDiagnostics.lowConfidenceRegions?.length || 0} color="var(--watch)" icon={MinusCircle} />
          <StatCard label={t('admin.ingestionRisk')} value={coverageDiagnostics.ingestionRiskRegions?.length || 0} color={coverageDiagnostics.ingestionRiskRegions?.length ? 'var(--critical)' : 'var(--low)'} icon={AlertTriangle} />
          <StatCard label={t('admin.sourceSparse')} value={coverageDiagnostics.sourceSparseRegions?.length || 0} color="var(--cyan)" icon={Globe} />
        </div>
        {(coverageDiagnostics.lowConfidenceRegions?.length > 0 ||
          coverageDiagnostics.ingestionRiskRegions?.length > 0 ||
          coverageDiagnostics.sourceSparseRegions?.length > 0) ? (
          <div className="admin-coverage-gaps">
            {coverageDiagnostics.ingestionRiskRegions?.length > 0 && (
              <div className="admin-gap-group">
                <h3 className="admin-gap-label admin-gap-critical">
                  <AlertTriangle size={12} /> {t('admin.ingestionRisk')}
                </h3>
                <div className="admin-gap-list">
                {coverageDiagnostics.ingestionRiskRegions.map((r) => (
                  <div key={r.iso} className="admin-gap-item">
                    <span className="admin-gap-region">{r.region || r.iso}</span>
                    <span className="admin-gap-detail">
                      <strong>{r.failedFeeds}</strong>
                      <span>/ {r.feedCount} {t('admin.failedSources').toLowerCase()}</span>
                    </span>
                  </div>
                ))}
                </div>
              </div>
            )}
            {coverageDiagnostics.lowConfidenceRegions?.length > 0 && (
              <div className="admin-gap-group">
                <h3 className="admin-gap-label admin-gap-warning">
                  <MinusCircle size={12} /> {t('admin.lowConfidence')}
                </h3>
                <div className="admin-gap-list">
                {coverageDiagnostics.lowConfidenceRegions.map((r) => (
                  <div key={r.iso} className="admin-gap-item">
                    <span className="admin-gap-region">{r.region || r.iso}</span>
                    <span className="admin-gap-detail">
                      <strong>{r.maxConfidence}%</strong>
                      <span>{t('admin.confidence', 'confidence')}</span>
                    </span>
                  </div>
                ))}
                </div>
              </div>
            )}
            {coverageDiagnostics.sourceSparseRegions?.length > 0 && (
              <div className="admin-gap-group">
                <h3 className="admin-gap-label admin-gap-sparse">
                  <Globe size={12} /> {t('admin.sourceSparse')}
                </h3>
                <div className="admin-gap-list">
                {coverageDiagnostics.sourceSparseRegions.map((r) => (
                  <div key={r.iso} className="admin-gap-item">
                    <span className="admin-gap-region">{r.region || r.iso}</span>
                    <span className="admin-gap-detail">
                      <strong>{r.feedCount || 0}</strong>
                      <span>{t('admin.feeds', 'feeds')}</span>
                    </span>
                  </div>
                ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="admin-no-gaps">{t('admin.noCoverageGaps')}</p>
        )}
      </Section>}

      {/* Source Health Table */}
      {activeSection === 'sources' && <Section title={t('admin.sourceHealth')} subtitle={t('admin.sourceHealthDesc')} icon={Rss} defaultOpen={true}>
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
          <div className="admin-table-wrap">
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
                {paginatedFilteredFeeds.map((feed) => (
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
          <AdminPagination
            page={sourceHealthPage}
            total={filteredFeeds.length}
            onPageChange={setSourceHealthPage}
            label={`${filteredFeeds.length} / ${mergedFeeds.length} ${t('admin.sourcesTotal')}`}
          />
        </div>
      </Section>}

      {/* Source Management */}
      {activeSection === 'manage' && <Section title={t('admin.sourceManagement')} subtitle={t('admin.sourceManagementDesc')} icon={Sliders} defaultOpen={true}>
        {/* Status messages */}
        {sourceActionError && (
          <div className="admin-msg admin-msg-error">
            <AlertTriangle size={14} />
            <span>{sourceActionError}</span>
            <button className="admin-msg-close" onClick={clearSourceMessages}>×</button>
          </div>
        )}
        {sourceActionOk && (
          <div className="admin-msg admin-msg-ok">
            <CheckCircle size={14} />
            <span>{sourceActionOk}</span>
            <button className="admin-msg-close" onClick={clearSourceMessages}>×</button>
          </div>
        )}

        {/* Action bar */}
        <div className="admin-source-actions">
          <button className="admin-btn admin-btn-primary" onClick={() => { setShowAddForm(true); clearSourceMessages(); setEditingSource(null); }}>
            <Plus size={14} /> {t('admin.addSource')}
          </button>
          <button className="admin-btn admin-btn-secondary" onClick={() => { setShowImport(true); clearSourceMessages(); }}>
            <Upload size={14} /> {t('admin.importSources')}
          </button>
          <button className="admin-btn admin-btn-secondary" onClick={() => { setShowExport(true); clearSourceMessages(); }}>
            <Download size={14} /> {t('admin.exportSources')}
          </button>
        </div>

        {/* Add source form */}
        {showAddForm && (
          <div className="admin-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAddForm(false); }}>
          <form className="admin-source-form admin-modal" onSubmit={handleAddSource} role="dialog" aria-modal="true" aria-label={t('admin.addNewSource')}>
            <h3 className="admin-form-title">{t('admin.addNewSource')}</h3>
            <div className="admin-form-tabs">
              <button
                type="button"
                className={`admin-form-tab ${addFormType === 'rss' ? 'is-active' : ''}`}
                onClick={() => setAddFormType('rss')}
              >
                <Rss size={12} /> {t('admin.rssFeed')}
              </button>
              <button
                type="button"
                className={`admin-form-tab ${addFormType === 'gdelt' ? 'is-active' : ''}`}
                onClick={() => setAddFormType('gdelt')}
              >
                <Globe size={12} /> {t('admin.gdeltQuery')}
              </button>
            </div>
            <div className="admin-form-grid">
              <div className="admin-form-field">
                <label className="admin-form-label">{t('admin.sourceNameLabel')} *</label>
                <input
                  type="text"
                  className="admin-form-input"
                  value={addForm.name}
                  onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={addFormType === 'rss' ? t('admin.rssNamePlaceholder') : t('admin.gdeltNamePlaceholder')}
                  required
                />
              </div>
              <div className="admin-form-field">
                <label className="admin-form-label">{addFormType === 'gdelt' ? t('admin.gdeltQueryLabel') : t('admin.urlLabel')} *</label>
                <input
                  type="text"
                  className="admin-form-input"
                  value={addFormType === 'gdelt' ? addForm.gdeltQuery : addForm.url}
                  onChange={(e) => setAddForm((f) => addFormType === 'gdelt' ? { ...f, gdeltQuery: e.target.value } : { ...f, url: e.target.value })}
                  placeholder={addFormType === 'gdelt' ? t('admin.gdeltQueryPlaceholder') : 'https://example.com/rss'}
                  required
                />
              </div>
              {addFormType === 'gdelt' && (
                <div className="admin-form-field">
                  <label className="admin-form-label">{t('admin.gdeltSearchUrlLabel')}</label>
                  <input
                    type="text"
                    className="admin-form-input"
                    value={addForm.url}
                    onChange={(e) => setAddForm((f) => ({ ...f, url: e.target.value }))}
                    placeholder="https://api.gdeltproject.org/api/v2/doc/doc?query=..."
                  />
                </div>
              )}
              <div className="admin-form-field">
                <label className="admin-form-label">{t('admin.countryLabel')}</label>
                <input
                  type="text"
                  className="admin-form-input"
                  value={addForm.country}
                  onChange={(e) => setAddForm((f) => ({ ...f, country: e.target.value }))}
                  placeholder={t('admin.countryPlaceholder')}
                />
              </div>
              <div className="admin-form-field">
                <label className="admin-form-label">{t('admin.sourceTypeLabel')}</label>
                <select
                  className="admin-form-select"
                  value={addForm.sourceType}
                  onChange={(e) => setAddForm((f) => ({ ...f, sourceType: e.target.value }))}
                >
                  <option value="">{t('admin.sourceTypeDefault')}</option>
                  <option value="official">{t('admin.sourceTypeOfficial')}</option>
                  <option value="wire">{t('admin.sourceTypeWire')}</option>
                  <option value="global">{t('admin.sourceTypeGlobal')}</option>
                  <option value="regional">{t('admin.sourceTypeRegional')}</option>
                  <option value="local">{t('admin.sourceTypeLocal')}</option>
                </select>
              </div>
              <div className="admin-form-field admin-form-field-full">
                <label className="admin-form-label">{t('admin.notesLabel')}</label>
                <input
                  type="text"
                  className="admin-form-input"
                  value={addForm.notes}
                  onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder={t('admin.notesPlaceholder')}
                />
              </div>
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn admin-btn-primary" disabled={!addForm.name || !(addFormType === 'gdelt' ? addForm.gdeltQuery : addForm.url)}>
                {t('admin.saveSource')}
              </button>
              <button type="button" className="admin-btn admin-btn-ghost" onClick={() => { setShowAddForm(false); clearSourceMessages(); }}>
                {t('admin.cancel')}
              </button>
            </div>
          </form>
          </div>
        )}

        {/* Import modal */}
        {showImport && (
          <div className="admin-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowImport(false); }}>
          <div className="admin-source-form admin-modal" role="dialog" aria-modal="true" aria-label={t('admin.importSourcesTitle')}>
            <h3 className="admin-form-title">{t('admin.importSourcesTitle')}</h3>
            {importError && (
              <div className="admin-msg admin-msg-error">
                <AlertTriangle size={14} />
                <span>{importError}</span>
              </div>
            )}
            <div className="admin-form-tabs">
              <button
                type="button"
                className={`admin-form-tab ${!importFile ? 'is-active' : ''}`}
                onClick={() => setImportFile(null)}
              >
                <FileText size={12} /> {t('admin.pasteJson')}
              </button>
              <button
                type="button"
                className={`admin-form-tab ${importFile ? 'is-active' : ''}`}
                onClick={() => { setImportJson(''); document.getElementById('admin-import-file-input')?.click(); }}
              >
                <Upload size={12} /> {t('admin.uploadFile')}
              </button>
            </div>
            {importFile ? (
              <div className="admin-import-file-info">
                <FileText size={14} />
                <span>{importFile.name}</span>
                <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setImportFile(null)}>
                  {t('admin.changeFile')}
                </button>
              </div>
            ) : (
              <textarea
                className="admin-form-textarea"
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder={t('admin.pasteJsonPlaceholder')}
                rows={8}
              />
            )}
            <input
              id="admin-import-file-input"
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
            />
            <div className="admin-form-actions">
              <button
                type="button"
                className="admin-btn admin-btn-primary"
                onClick={importFile ? handleImportFile : handleImportJson}
                disabled={importFile ? false : !importJson.trim()}
              >
                {t('admin.importSubmit')}
              </button>
              <button type="button" className="admin-btn admin-btn-ghost" onClick={() => { setShowImport(false); setImportJson(''); setImportFile(null); setImportError(''); }}>
                {t('admin.cancel')}
              </button>
            </div>
          </div>
          </div>
        )}

        {showExport && (
          <div className="admin-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowExport(false); }}>
            <div className="admin-source-form admin-modal admin-export-modal" role="dialog" aria-modal="true" aria-label={t('admin.exportSources')}>
              <h3 className="admin-form-title">{t('admin.exportSources')}</h3>
              <p className="admin-form-help">{t('admin.exportSourcesHelp', 'Download the current source catalog as a JSON file for backup or migration.')}</p>
              <div className="admin-form-actions">
                <button type="button" className="admin-btn admin-btn-primary" onClick={() => { handleExport(); setShowExport(false); }}>
                  <Download size={14} /> {t('admin.exportSources')}
                </button>
                <button type="button" className="admin-btn admin-btn-ghost" onClick={() => setShowExport(false)}>
                  {t('admin.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit source inline form */}
        {editingSource && (
          <form className="admin-source-form admin-edit-form" onSubmit={handleEditSave}>
            <h3 className="admin-form-title">{t('admin.editSource')}</h3>
            <div className="admin-form-grid">
              <div className="admin-form-field">
                <label className="admin-form-label">{t('admin.sourceNameLabel')}</label>
                <input type="text" className="admin-form-input" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="admin-form-field">
                <label className="admin-form-label">{t('admin.urlLabel')}</label>
                <input type="text" className="admin-form-input" value={editForm.url} onChange={(e) => setEditForm((f) => ({ ...f, url: e.target.value }))} required />
              </div>
              <div className="admin-form-field">
                <label className="admin-form-label">{t('admin.countryLabel')}</label>
                <input type="text" className="admin-form-input" value={editForm.country} onChange={(e) => setEditForm((f) => ({ ...f, country: e.target.value }))} />
              </div>
              <div className="admin-form-field">
                <label className="admin-form-label">{t('admin.sourceTypeLabel')}</label>
                <select className="admin-form-select" value={editForm.sourceType} onChange={(e) => setEditForm((f) => ({ ...f, sourceType: e.target.value }))}>
                  <option value="">{t('admin.sourceTypeDefault')}</option>
                  <option value="official">{t('admin.sourceTypeOfficial')}</option>
                  <option value="wire">{t('admin.sourceTypeWire')}</option>
                  <option value="global">{t('admin.sourceTypeGlobal')}</option>
                  <option value="regional">{t('admin.sourceTypeRegional')}</option>
                  <option value="local">{t('admin.sourceTypeLocal')}</option>
                </select>
              </div>
              <div className="admin-form-field admin-form-field-full">
                <label className="admin-form-label">{t('admin.notesLabel')}</label>
                <input type="text" className="admin-form-input" value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn admin-btn-primary">{t('admin.saveSource')}</button>
              <button type="button" className="admin-btn admin-btn-ghost" onClick={() => { setEditingSource(null); clearSourceMessages(); }}>{t('admin.cancel')}</button>
            </div>
          </form>
        )}

        {/* Source list with actions */}
        <div className="admin-table-controls admin-mt">
          <div className="admin-search-wrapper">
            <Search size={14} className="admin-search-icon" />
            <input
              type="text"
              className="admin-search-input"
              placeholder={t('admin.searchSourcesManage')}
              value={manageSearchQuery}
              onChange={(e) => setManageSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {filteredManageFeeds.length === 0 ? (
          <p className="admin-no-sources">{t('admin.noSourcesFound')}</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="admin-th">{t('admin.name')}</th>
                  <th className="admin-th">{t('admin.type')}</th>
                  <th className="admin-th">{t('admin.status')}</th>
                  <th className="admin-th">{t('admin.autoDisabledLabel')}</th>
                  <th className="admin-th admin-th-right">{t('admin.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {paginatedManageFeeds.map((feed) => {
                  const isAutoDisabled = feed.autoDisabled === true || (feed.enabled === false && feed.lastStatus === 'failed');
                  return (
                    <tr key={feed.id} className={`admin-tr ${isAutoDisabled ? 'admin-tr-disabled' : ''}`}>
                      <td className="admin-td admin-td-name" title={feed.url}>
                        <div className="admin-source-name-row">
                          <span>{feed.name || feed.id}</span>
                          <FetchModeBadge mode={feed.fetchMode} />
                        </div>
                      </td>
                      <td className="admin-td">
                        <span className="admin-source-type">{feed.sourceClass || feed.sourceType || '—'}</span>
                      </td>
                      <td className="admin-td"><StatusBadge status={feed.enabled === false ? 'failed' : feed.lastStatus} /></td>
                      <td className="admin-td">
                        {isAutoDisabled ? (
                          <span className="admin-auto-disabled-badge">
                            <PowerOff size={11} /> {t('admin.autoDisabled')}
                          </span>
                        ) : feed.enabled === false ? (
                          <span className="admin-disabled-badge">
                            <MinusCircle size={11} /> {t('admin.disabled')}
                          </span>
                        ) : (
                          <span className="admin-active-badge">
                            <CheckCircle size={11} /> {t('admin.active')}
                          </span>
                        )}
                      </td>
                      <td className="admin-td admin-td-right admin-td-actions">
                        {feed.enabled === false ? (
                          <button
                            className="admin-btn-icon admin-btn-icon-enable"
                            onClick={() => handleReEnable(feed.id)}
                            title={t('admin.reEnable')}
                          >
                            <Power size={14} />
                          </button>
                        ) : (
                          <button
                            className="admin-btn-icon admin-btn-icon-edit"
                            onClick={() => handleEditClick(feed)}
                            title={t('admin.editSource')}
                          >
                            <Edit size={14} />
                          </button>
                        )}
                        <button
                          className="admin-btn-icon admin-btn-icon-delete"
                          onClick={() => handleDeleteSource(feed.id)}
                          title={t('admin.deleteSource')}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="admin-table-footer">
          <AdminPagination
            page={sourceManagePage}
            total={filteredManageFeeds.length}
            onPageChange={setSourceManagePage}
          />
        </div>
      </Section>}

      {/* Feature Access */}
      {activeSection === 'features' && <Section title={t('admin.featureAccess', 'Feature Access')} subtitle={t('admin.featureAccessDesc', 'Control which account tier can use each product feature.')} icon={Shield} defaultOpen={true}>
        {featureActionError && (
          <div className="admin-msg admin-msg-error">
            <AlertTriangle size={14} />
            <span>{featureActionError}</span>
            <button className="admin-msg-close" onClick={() => setFeatureActionError('')}>×</button>
          </div>
        )}
        {featureActionOk && (
          <div className="admin-msg admin-msg-ok">
            <CheckCircle size={14} />
            <span>{featureActionOk}</span>
            <button className="admin-msg-close" onClick={() => setFeatureActionOk('')}>×</button>
          </div>
        )}

        <div className="admin-feature-panel">
          <div className="admin-feature-billing">
            <div>
              <h3>{t('admin.subscriptionService', 'Subscription service')}</h3>
              <p>{t('admin.subscriptionServiceDesc', 'Enable Stripe upgrade and billing portal flows. When disabled, MAPR ignores plan tiers and treats every product feature as free.')}</p>
            </div>
            <button
              type="button"
              className={`admin-feature-switch ${featureFlags.billingEnabled ? 'is-on' : 'is-off'}`}
              onClick={handleBillingToggle}
              disabled={savingFeatureFlags}
              aria-pressed={featureFlags.billingEnabled}
            >
              {featureFlags.billingEnabled ? <Power size={14} /> : <PowerOff size={14} />}
              <span>{featureFlags.billingEnabled ? t('admin.enabled', 'Enabled') : t('admin.disabled', 'Disabled')}</span>
            </button>
          </div>

          <div className="admin-feature-actions">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => handleBulkFeatureTier(FEATURE_TIER_FREE)} disabled={savingFeatureFlags}>
              {t('admin.makeAllFree', 'Make all free')}
            </button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => handleBulkFeatureTier(FEATURE_TIER_PRO)} disabled={savingFeatureFlags}>
              {t('admin.requireProForAll', 'Require Pro for all')}
            </button>
          </div>

          <div className="admin-feature-list">
            {FEATURE_ACCESS_CATALOG.map((feature) => {
              const selectedTier = featureFlags.features[feature.id] || feature.defaultTier;
              return (
                <div key={feature.id} className="admin-feature-row">
                  <div className="admin-feature-copy">
                    <span className="admin-feature-category">{feature.category}</span>
                    <h3>{t(`admin.featureNames.${feature.id}`, feature.label)}</h3>
                    <p>{t(`admin.featureDescriptions.${feature.id}`, feature.description)}</p>
                  </div>
                  <div className="admin-feature-tier-group" role="radiogroup" aria-label={feature.label}>
                    {[
                      [FEATURE_TIER_FREE, t('admin.freeUsers', 'Free users')],
                      [FEATURE_TIER_PRO, t('admin.proUsers', 'Pro users')],
                      [FEATURE_TIER_DISABLED, t('admin.off', 'Off')],
                    ].map(([tier, label]) => (
                      <button
                        key={tier}
                        type="button"
                        className={`admin-feature-tier ${selectedTier === tier ? 'is-active' : ''}`}
                        onClick={() => handleFeatureTierChange(feature.id, tier)}
                        disabled={savingFeatureFlags}
                        aria-pressed={selectedTier === tier}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {featureFlags.updatedAt && (
            <p className="admin-feature-updated">
              {t('admin.featuresUpdatedAt', { time: new Date(featureFlags.updatedAt).toLocaleString(getLocale()) })}
            </p>
          )}
        </div>
      </Section>}

      {/* Source Reliability Table */}
      {activeSection === 'reliability' && <Section title={t('admin.sourceReliability')} subtitle={t('admin.sourceReliabilityDesc')} icon={ShieldCheck} defaultOpen={true}>
        {sortedReliability.length === 0 ? (
          <p className="admin-no-sources">{t('admin.noReliabilityData')}</p>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th className="admin-th admin-th-sortable" onClick={() => handleReliabilitySort('sourceKey')}>
                      {t('admin.sourceName')} <ReliabilitySortIcon col="sourceKey" />
                    </th>
                    <th className="admin-th admin-th-sortable admin-th-right" onClick={() => handleReliabilitySort('score')}>
                      {t('admin.credibilityScore')} <ReliabilitySortIcon col="score" />
                    </th>
                    <th className="admin-th admin-th-sortable admin-th-right" onClick={() => handleReliabilitySort('totalEvents')}>
                      {t('admin.totalEvents')} <ReliabilitySortIcon col="totalEvents" />
                    </th>
                    <th className="admin-th admin-th-sortable admin-th-right" onClick={() => handleReliabilitySort('corroboratedEvents')}>
                      {t('admin.corroborated')} <ReliabilitySortIcon col="corroboratedEvents" />
                    </th>
                    <th className="admin-th admin-th-sortable" onClick={() => handleReliabilitySort('lastUpdatedAt')}>
                      {t('admin.lastChecked')} <ReliabilitySortIcon col="lastUpdatedAt" />
                    </th>
                    <th className="admin-th">{t('admin.trend')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedReliabilityData.map((entry) => (
                    <tr key={entry.sourceKey} className="admin-tr">
                      <td className="admin-td admin-td-name" title={entry.sourceKey}>
                        {entry.sourceKey.replace(/-/g, ' ').toUpperCase()}
                      </td>
                      <td className="admin-td admin-td-right">
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          color: getScoreColor(entry.score),
                          fontWeight: 600,
                        }}>
                          <span style={{
                            display: 'inline-block',
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: getScoreColor(entry.score),
                          }} />
                          {Math.round(entry.score * 100)}%
                          <span style={{ fontSize: 10, opacity: 0.6, fontWeight: 400 }}>
                            ({getScoreLabel(entry.score)})
                          </span>
                        </span>
                      </td>
                      <td className="admin-td admin-td-right">{entry.totalEvents}</td>
                      <td className="admin-td admin-td-right">{entry.corroboratedEvents}</td>
                      <td className="admin-td admin-td-time">{formatTime(entry.lastUpdatedAt) || t('admin.never')}</td>
                      <td className="admin-td">{getTrendIcon(entry.score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="admin-table-footer">
              <AdminPagination
                page={reliabilityPage}
                total={sortedReliability.length}
                onPageChange={setReliabilityPage}
              />
            </div>
          </>
        )}
      </Section>}
      </main>
    </div>
  );
}
