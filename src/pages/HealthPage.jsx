import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mergeAdminHealthPayloads } from '../utils/healthSummary.js';
import useKeyboardNavigation from '../hooks/useKeyboardNavigation';
import ShortcutHelp from '../components/ShortcutHelp.jsx';
import { formatTime } from '../utils/formatDate.js';

const STATUS_COLORS = {
  ok: 'var(--sev-green)',
  operational: 'var(--sev-green)',
  healthy: 'var(--sev-green)',
  empty: 'var(--sev-amber)',
  degraded: 'var(--elevated)',
  stale: 'var(--elevated)',
  failed: 'var(--sev-red)',
  error: 'var(--sev-red)',
  offline: 'var(--sev-red)',
};

const OK = 'var(--sev-green)';
const WARN = 'var(--sev-amber)';
const ATTENTION = 'var(--elevated)';
const BAD = 'var(--sev-red)';

const getColor = (status) => STATUS_COLORS[status] || 'var(--ink-2)';

const HealthPage = () => {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);

  const handleLogin = useCallback(async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setAuthed(true);
      } else if (res.status === 503) {
        setAuthError('Admin not configured on server');
      } else {
        setAuthError('Invalid password');
      }
    } catch {
      setAuthError('Connection failed');
    }
  }, [password]);

  useEffect(() => {
    fetch('/api/admin/session', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) setAuthed(true);
      })
      .catch(() => {});
  }, []);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [adminRes, opsRes] = await Promise.all([
        fetch('/api/admin-health', { credentials: 'include' }),
        fetch('/api/health').catch(() => null),
      ]);

      if (adminRes.status === 401) {
        setAuthed(false);
        setError('Session expired');
        return;
      }
      if (!adminRes.ok) throw new Error(`HTTP ${adminRes.status}`);

      const adminPayload = await adminRes.json();
      const opsPayload = opsRes?.ok ? await opsRes.json().catch(() => null) : null;

      setData(mergeAdminHealthPayloads(adminPayload, opsPayload || {}));
      setLastRefresh(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed) fetchHealth();
  }, [authed, fetchHealth]);

  // Auto-refresh every 60s
  useEffect(() => {
    if (!authed) return;
    const id = setInterval(fetchHealth, 60000);
    return () => clearInterval(id);
  }, [authed, fetchHealth]);

  const s = styles;

  const navigate = useNavigate();

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
    return (
      <div style={s.page}>
        <ShortcutHelp />
        <div style={s.loginCard}>
          <div style={s.loginTitle}>MAPR ADMIN</div>
          <form onSubmit={handleLogin} style={s.loginForm}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              style={s.input}
              autoFocus
            />
            <button type="submit" style={s.btn}>AUTHENTICATE</button>
          </form>
          {authError && <div style={s.error}>{authError}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <ShortcutHelp />
      <div style={s.container}>
        {/* Header */}
        <div style={s.header}>
          <span style={s.headerTitle}>SYSTEM HEALTH</span>
          <div style={s.headerRight}>
            {lastRefresh && <span style={s.dim}>Updated {formatTime(lastRefresh, null, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
            <button onClick={fetchHealth} style={s.btnSmall} disabled={loading}>
              {loading ? 'LOADING...' : 'REFRESH'}
            </button>
            <button
              type="button"
              onClick={async () => {
                await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
                setAuthed(false);
              }}
              style={s.btnSmall}
            >
              LOGOUT
            </button>
          </div>
        </div>

        {error && <div style={s.error}>{error}</div>}

        {data && (
          <>
            {/* Pipeline */}
            <Section title="DATA PIPELINE">
              <Grid>
                <Stat label="Source" value={data.pipeline.source} />
                <Stat label="Fetched" value={data.pipeline.fetchedAt ? formatTime(data.pipeline.fetchedAt) : '—'} />
                <Stat label="GDELT Articles" value={data.pipeline.gdeltArticles} color={data.pipeline.gdeltArticles > 0 ? OK : BAD} />
                <Stat label="Feed Articles" value={data.pipeline.rssArticles} color={data.pipeline.rssArticles > 0 ? OK : ATTENTION} />
                <Stat label="Total Articles" value={data.pipeline.totalArticles} />
                <Stat label="Total Events" value={data.pipeline.totalEvents} />
                <Stat label="Content Feeds" value={data.pipeline.totalFeeds} />
              </Grid>
            </Section>

            {/* Source Health */}
            <Section title="SOURCE HEALTH">
              <Grid>
                <Stat
                  label="GDELT Status"
                  value={data.sourceHealth.gdelt?.status?.toUpperCase() || 'UNKNOWN'}
                  color={getColor(data.sourceHealth.gdelt?.status)}
                />
                <Stat
                  label="GDELT Profiles"
                  value={`${data.sourceHealth.gdelt?.healthyProfiles || 0}/${data.sourceHealth.gdelt?.totalProfiles || 0}`}
                  color={data.sourceHealth.gdelt?.healthyProfiles > 0 ? OK : BAD}
                />
                <Stat
                  label="Feed Status"
                  value={data.sourceHealth.rss?.status?.toUpperCase() || 'UNKNOWN'}
                  color={getColor(data.sourceHealth.rss?.status)}
                />
                <Stat
                  label="Feeds Reachable"
                  value={`${data.sourceHealth.rss?.reachableFeeds || 0}/${data.sourceHealth.rss?.totalFeeds || 0}`}
                  color={(data.sourceHealth.rss?.reachableFeeds || 0) >= (data.sourceHealth.rss?.totalFeeds || 0) * 0.7 ? OK : ATTENTION}
                />
                <Stat
                  label="Feeds Failed"
                  value={data.sourceHealth.rss?.failedFeeds || 0}
                  color={data.sourceHealth.rss?.failedFeeds > 0 ? ATTENTION : OK}
                />
                <Stat
                  label="Feeds Empty"
                  value={data.sourceHealth.rss?.emptyFeeds || 0}
                  color={data.sourceHealth.rss?.emptyFeeds > 0 ? WARN : OK}
                />
                <Stat
                  label="Backend"
                  value={data.sourceHealth.backend?.status?.toUpperCase() || 'UNKNOWN'}
                  color={getColor(data.sourceHealth.backend?.status)}
                />
              </Grid>
            </Section>

            {/* Coverage */}
            <Section title="COVERAGE">
              <Grid>
                <Stat label="Coverage Rate" value={`${Math.round((data.coverageMetrics?.coverageRate || 0) * 100)}%`} />
                <Stat label="Covered" value={data.coverageMetrics?.coveredCountries || 0} color={OK} />
                <Stat label="Verified" value={data.coverageMetrics?.verifiedCountries || 0} color={OK} />
                <Stat label="Uncovered" value={data.coverageMetrics?.uncoveredCountries || 0} color={ATTENTION} />
              </Grid>
            </Section>

            {/* Diagnostics */}
            <Section title="DIAGNOSTICS">
              <Grid>
                <Stat label="Low Confidence" value={data.coverageDiagnostics?.lowConfidenceCountries || 0} color={data.coverageDiagnostics?.lowConfidenceCountries > 0 ? WARN : OK} />
                <Stat label="Ingestion Risk" value={data.coverageDiagnostics?.ingestionRiskCountries || 0} color={data.coverageDiagnostics?.ingestionRiskCountries > 0 ? BAD : OK} />
                <Stat label="Source Sparse" value={data.coverageDiagnostics?.sourceSparseCountries || 0} color={data.coverageDiagnostics?.sourceSparseCountries > 0 ? ATTENTION : OK} />
              </Grid>

              {data.coverageDiagnostics?.lowConfidenceRegions?.length > 0 && (
                <div style={{ marginTop: '0.6rem' }}>
                  <div style={s.subLabel}>LOW CONFIDENCE REGIONS</div>
                  {data.coverageDiagnostics.lowConfidenceRegions.map((r) => (
                    <div key={r.iso} style={s.listItem}>
                      <span>{r.region || r.iso}</span>
                      <span style={{ color: WARN }}>{r.maxConfidence}%</span>
                    </div>
                  ))}
                </div>
              )}

              {data.coverageDiagnostics?.ingestionRiskRegions?.length > 0 && (
                <div style={{ marginTop: '0.6rem' }}>
                  <div style={s.subLabel}>INGESTION RISK REGIONS</div>
                  {data.coverageDiagnostics.ingestionRiskRegions.map((r) => (
                    <div key={r.iso} style={s.listItem}>
                      <span>{r.region || r.iso}</span>
                      <span style={{ color: BAD }}>{r.failedFeeds}/{r.feedCount} failed</span>
                    </div>
                  ))}
                </div>
              )}

              {data.coverageDiagnostics?.sourceSparseRegions?.length > 0 && (
                <div style={{ marginTop: '0.6rem' }}>
                  <div style={s.subLabel}>SOURCE SPARSE REGIONS</div>
                  {data.coverageDiagnostics.sourceSparseRegions.map((r) => (
                    <div key={r.iso} style={s.listItem}>
                      <span>{r.region || r.iso}</span>
                      <span style={{ color: ATTENTION }}>{r.feedCount || 0} feeds</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="SOURCE FAILURES">
              {(data.sourceHealth.gdelt?.profiles || []).filter((profile) => profile.status === 'failed').length > 0 && (
                <div style={{ marginBottom: '0.8rem' }}>
                  <div style={s.subLabel}>FAILED GDELT PROFILES</div>
                  {data.sourceHealth.gdelt.profiles
                    .filter((profile) => profile.status === 'failed')
                    .map((profile) => (
                      <div key={profile.id} style={s.listItem}>
                        <span>{profile.id}</span>
                        <span style={{ color: ATTENTION }}>{profile.error || 'Failed'}</span>
                      </div>
                    ))}
                </div>
              )}

              {(data.sourceHealth.rss?.feeds || []).filter((feed) => feed.status === 'failed').length > 0 && (
                <div>
                  <div style={s.subLabel}>FAILED RSS FEEDS</div>
                  {data.sourceHealth.rss.feeds
                    .filter((feed) => feed.status === 'failed')
                    .slice(0, 16)
                    .map((feed) => (
                      <div key={feed.feedId} style={s.listItem}>
                        <span>{feed.name}</span>
                        <span style={{ color: ATTENTION }}>{feed.error || 'Failed'}</span>
                      </div>
                    ))}
                </div>
              )}
            </Section>

            {/* Raw JSON */}
            <Section title="RAW RESPONSE">
              <pre style={s.pre}>{JSON.stringify(data, null, 2)}</pre>
            </Section>
          </>
        )}
      </div>
    </div>
  );
};

/* ── Sub-components ── */

const Section = ({ title, children }) => (
  <div style={styles.section}>
    <div style={styles.sectionTitle}>{title}</div>
    {children}
  </div>
);

const Grid = ({ children }) => (
  <div style={styles.grid}>{children}</div>
);

const Stat = ({ label, value, color }) => (
  <div style={styles.stat}>
    <span style={styles.statLabel}>{label}</span>
    <strong style={{ ...styles.statValue, color: color || 'var(--ink-0)' }}>{value}</strong>
  </div>
);

/* ── Styles ── */

const styles = {
  page: {
    minHeight: '100dvh',
    background: 'var(--bg-0)',
    color: 'var(--ink-0)',
    fontFamily: 'var(--ff-mono)',
    fontSize: '12px',
    display: 'flex',
    justifyContent: 'center',
    padding: '20px 28px 28px',
  },
  container: {
    width: '100%',
    maxWidth: '1100px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px',
    padding: '0 0 16px',
    borderBottom: '1px solid var(--line)',
    background: 'transparent',
  },
  headerTitle: {
    fontSize: '14px',
    fontWeight: 600,
    letterSpacing: '0.1em',
    color: 'var(--accent)',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
  },
  dim: { color: 'var(--ink-2)', fontSize: '10px' },
  section: {
    marginBottom: '12px',
    padding: '14px 0',
    borderTop: '1px solid var(--line)',
    background: 'transparent',
  },
  sectionTitle: {
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.12em',
    color: 'var(--accent)',
    marginBottom: '0.6rem',
    textTransform: 'uppercase',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: '0.4rem',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
    padding: '8px 12px',
    background: 'transparent',
    borderLeft: '1px solid var(--line)',
  },
  statLabel: { fontSize: '9px', color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  statValue: { fontSize: '13px', fontWeight: 500 },
  subLabel: {
    fontSize: '9px',
    fontWeight: 600,
    letterSpacing: '0.1em',
    color: 'var(--ink-2)',
    marginBottom: '0.35rem',
    textTransform: 'uppercase',
  },
  listItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.25rem 0.4rem',
    fontSize: '11px',
    borderBottom: '1px solid var(--line)',
  },
  pre: {
    background: 'var(--bg-2)',
    padding: '0.75rem',
    fontSize: '10px',
    color: 'var(--ink-1)',
    overflow: 'auto',
    maxHeight: '400px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  error: {
    color: 'var(--sev-red)',
    fontSize: '11px',
    marginTop: '0.5rem',
    padding: '0.4rem 0.6rem',
    border: '1px solid var(--sev-red)',
    background: 'color-mix(in srgb, var(--sev-red) 8%, var(--bg-0))',
  },
  loginCard: {
    width: '100%',
    maxWidth: '300px',
    padding: '1.5rem',
    border: '1px solid var(--line)',
    background: 'var(--bg-1)',
    marginTop: '20vh',
  },
  loginTitle: {
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.12em',
    color: 'var(--accent)',
    marginBottom: '1rem',
    textAlign: 'center',
  },
  loginForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
  },
  input: {
    width: '100%',
    padding: '0.5rem 0.6rem',
    background: 'var(--bg-2)',
    border: '1px solid var(--line-2)',
    color: 'var(--ink-0)',
    fontFamily: 'var(--ff-mono)',
    fontSize: '12px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  btn: {
    padding: '0.5rem',
    background: 'var(--accent-bg)',
    border: '1px solid var(--accent-border)',
    color: 'var(--accent)',
    fontFamily: 'var(--ff-mono)',
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.1em',
    cursor: 'pointer',
  },
  btnSmall: {
    padding: '0.3rem 0.5rem',
    background: 'var(--accent-bg)',
    border: '1px solid var(--accent-border)',
    color: 'var(--accent)',
    fontFamily: 'var(--ff-mono)',
    fontSize: '9px',
    fontWeight: 500,
    letterSpacing: '0.08em',
    cursor: 'pointer',
  },
};

export default HealthPage;
