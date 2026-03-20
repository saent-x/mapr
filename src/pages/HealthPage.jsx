import React, { useCallback, useEffect, useState } from 'react';
import { mergeAdminHealthPayloads } from '../utils/healthSummary.js';

const STATUS_COLORS = {
  ok: '#00e5a0',
  operational: '#00e5a0',
  healthy: '#00e5a0',
  empty: '#ffc93e',
  degraded: '#ff8a3d',
  stale: '#ff8a3d',
  failed: '#ff3b5c',
  error: '#ff3b5c',
  offline: '#ff3b5c',
};

const getColor = (status) => STATUS_COLORS[status] || '#64748b';

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
      const res = await fetch('/api/admin-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setAuthed(true);
        sessionStorage.setItem('admin-pw', password);
      } else {
        setAuthError('Invalid password');
      }
    } catch {
      setAuthError('Connection failed');
    }
  }, [password]);

  // Restore session
  useEffect(() => {
    const saved = sessionStorage.getItem('admin-pw');
    if (saved) {
      setPassword(saved);
      setAuthed(true);
    }
  }, []);

  const fetchHealth = useCallback(async () => {
    const pw = sessionStorage.getItem('admin-pw') || password;
    setLoading(true);
    setError('');
    try {
      const [adminRes, opsRes] = await Promise.all([
        fetch('/api/admin-health', {
          headers: { 'X-Admin-Password': pw },
        }),
        fetch('/api/health').catch(() => null),
      ]);

      if (adminRes.status === 401) {
        setAuthed(false);
        sessionStorage.removeItem('admin-pw');
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
  }, [password]);

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

  if (!authed) {
    return (
      <div style={s.page}>
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
      <div style={s.container}>
        {/* Header */}
        <div style={s.header}>
          <span style={s.headerTitle}>SYSTEM HEALTH</span>
          <div style={s.headerRight}>
            {lastRefresh && <span style={s.dim}>Updated {lastRefresh.toLocaleTimeString()}</span>}
            <button onClick={fetchHealth} style={s.btnSmall} disabled={loading}>
              {loading ? 'LOADING...' : 'REFRESH'}
            </button>
            <button onClick={() => { setAuthed(false); sessionStorage.removeItem('admin-pw'); }} style={s.btnSmall}>
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
                <Stat label="Fetched" value={data.pipeline.fetchedAt ? new Date(data.pipeline.fetchedAt).toLocaleTimeString() : '—'} />
                <Stat label="GDELT Articles" value={data.pipeline.gdeltArticles} color={data.pipeline.gdeltArticles > 0 ? '#00e5a0' : '#ff3b5c'} />
                <Stat label="Feed Articles" value={data.pipeline.rssArticles} color={data.pipeline.rssArticles > 0 ? '#00e5a0' : '#ff8a3d'} />
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
                  color={data.sourceHealth.gdelt?.healthyProfiles > 0 ? '#00e5a0' : '#ff3b5c'}
                />
                <Stat
                  label="Feed Status"
                  value={data.sourceHealth.rss?.status?.toUpperCase() || 'UNKNOWN'}
                  color={getColor(data.sourceHealth.rss?.status)}
                />
                <Stat
                  label="Feeds Reachable"
                  value={`${data.sourceHealth.rss?.reachableFeeds || 0}/${data.sourceHealth.rss?.totalFeeds || 0}`}
                  color={(data.sourceHealth.rss?.reachableFeeds || 0) >= (data.sourceHealth.rss?.totalFeeds || 0) * 0.7 ? '#00e5a0' : '#ff8a3d'}
                />
                <Stat
                  label="Feeds Failed"
                  value={data.sourceHealth.rss?.failedFeeds || 0}
                  color={data.sourceHealth.rss?.failedFeeds > 0 ? '#ff8a3d' : '#00e5a0'}
                />
                <Stat
                  label="Feeds Empty"
                  value={data.sourceHealth.rss?.emptyFeeds || 0}
                  color={data.sourceHealth.rss?.emptyFeeds > 0 ? '#ffc93e' : '#00e5a0'}
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
                <Stat label="Covered" value={data.coverageMetrics?.coveredCountries || 0} color="#00e5a0" />
                <Stat label="Verified" value={data.coverageMetrics?.verifiedCountries || 0} color="#00e5a0" />
                <Stat label="Uncovered" value={data.coverageMetrics?.uncoveredCountries || 0} color="#ff8a3d" />
              </Grid>
            </Section>

            {/* Diagnostics */}
            <Section title="DIAGNOSTICS">
              <Grid>
                <Stat label="Low Confidence" value={data.coverageDiagnostics?.lowConfidenceCountries || 0} color={data.coverageDiagnostics?.lowConfidenceCountries > 0 ? '#ffc93e' : '#00e5a0'} />
                <Stat label="Ingestion Risk" value={data.coverageDiagnostics?.ingestionRiskCountries || 0} color={data.coverageDiagnostics?.ingestionRiskCountries > 0 ? '#ff3b5c' : '#00e5a0'} />
                <Stat label="Source Sparse" value={data.coverageDiagnostics?.sourceSparseCountries || 0} color={data.coverageDiagnostics?.sourceSparseCountries > 0 ? '#ff8a3d' : '#00e5a0'} />
              </Grid>

              {data.coverageDiagnostics?.lowConfidenceRegions?.length > 0 && (
                <div style={{ marginTop: '0.6rem' }}>
                  <div style={s.subLabel}>LOW CONFIDENCE REGIONS</div>
                  {data.coverageDiagnostics.lowConfidenceRegions.map((r) => (
                    <div key={r.iso} style={s.listItem}>
                      <span>{r.region || r.iso}</span>
                      <span style={{ color: '#ffc93e' }}>{r.maxConfidence}%</span>
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
                      <span style={{ color: '#ff3b5c' }}>{r.failedFeeds}/{r.feedCount} failed</span>
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
                      <span style={{ color: '#ff8a3d' }}>{r.feedCount || 0} feeds</span>
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
                        <span style={{ color: '#ff8a3d' }}>{profile.error || 'Failed'}</span>
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
                        <span style={{ color: '#ff8a3d' }}>{feed.error || 'Failed'}</span>
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
    <strong style={{ ...styles.statValue, color: color || '#e2e8f0' }}>{value}</strong>
  </div>
);

/* ── Styles ── */

const styles = {
  page: {
    minHeight: '100vh',
    background: '#060a12',
    color: '#e2e8f0',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '12px',
    display: 'flex',
    justifyContent: 'center',
    padding: '2rem 1rem',
  },
  container: {
    width: '100%',
    maxWidth: '720px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '1.5rem',
    paddingBottom: '0.75rem',
    borderBottom: '1px solid rgba(0,200,255,0.1)',
  },
  headerTitle: {
    fontSize: '14px',
    fontWeight: 600,
    letterSpacing: '0.1em',
    color: '#00d4ff',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
  },
  dim: { color: '#64748b', fontSize: '10px' },
  section: {
    marginBottom: '1.25rem',
    padding: '0.75rem',
    border: '1px solid rgba(0,200,255,0.08)',
    borderRadius: '4px',
    background: 'rgba(0,200,255,0.02)',
  },
  sectionTitle: {
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.12em',
    color: '#00d4ff',
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
    padding: '0.4rem 0.5rem',
    background: 'rgba(0,200,255,0.03)',
    border: '1px solid rgba(0,200,255,0.06)',
    borderRadius: '3px',
  },
  statLabel: { fontSize: '9px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' },
  statValue: { fontSize: '13px', fontWeight: 500 },
  subLabel: {
    fontSize: '9px',
    fontWeight: 600,
    letterSpacing: '0.1em',
    color: '#64748b',
    marginBottom: '0.35rem',
    textTransform: 'uppercase',
  },
  listItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.25rem 0.4rem',
    fontSize: '11px',
    borderBottom: '1px solid rgba(0,200,255,0.04)',
  },
  pre: {
    background: 'rgba(0,0,0,0.3)',
    padding: '0.75rem',
    borderRadius: '3px',
    fontSize: '10px',
    color: '#94a3b8',
    overflow: 'auto',
    maxHeight: '400px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  error: {
    color: '#ff3b5c',
    fontSize: '11px',
    marginTop: '0.5rem',
    padding: '0.4rem 0.6rem',
    border: '1px solid rgba(255,59,92,0.2)',
    borderRadius: '3px',
    background: 'rgba(255,59,92,0.05)',
  },
  loginCard: {
    width: '100%',
    maxWidth: '300px',
    padding: '1.5rem',
    border: '1px solid rgba(0,200,255,0.1)',
    borderRadius: '4px',
    background: 'rgba(0,200,255,0.02)',
    marginTop: '20vh',
  },
  loginTitle: {
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.12em',
    color: '#00d4ff',
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
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(0,200,255,0.12)',
    borderRadius: '3px',
    color: '#e2e8f0',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '12px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  btn: {
    padding: '0.5rem',
    background: 'rgba(0,212,255,0.08)',
    border: '1px solid rgba(0,212,255,0.2)',
    borderRadius: '3px',
    color: '#00d4ff',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.1em',
    cursor: 'pointer',
  },
  btnSmall: {
    padding: '0.3rem 0.5rem',
    background: 'rgba(0,212,255,0.06)',
    border: '1px solid rgba(0,212,255,0.15)',
    borderRadius: '3px',
    color: '#00d4ff',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '9px',
    fontWeight: 500,
    letterSpacing: '0.08em',
    cursor: 'pointer',
  },
};

export default HealthPage;
