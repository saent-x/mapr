import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Trash2, Save, ExternalLink, AlertTriangle } from 'lucide-react';
import {
  fetchBeatProfile,
  saveBeatProfile,
  deleteBeatProfile,
  fetchBeatMatches,
} from '../../services/backendService.js';

function relative(iso) {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function BeatSection() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [profile, setProfile] = useState(null);
  const [matches, setMatches] = useState([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const refreshMatches = useCallback(async () => {
    try {
      const res = await fetchBeatMatches({ limit: 5 });
      setMatches(res?.matches || []);
    } catch (err) { /* ignore */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchBeatProfile()
      .then(({ profile }) => {
        if (cancelled) return;
        setProfile(profile);
        setText(profile?.description || '');
        if (profile) refreshMatches();
      })
      .catch(() => { /* unauth + similar — leave defaults */ });
    return () => { cancelled = true; };
  }, [refreshMatches]);

  const handleSave = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed.length < 12) {
      setError(t('beat.errorTooShort'));
      setErrorCode(null);
      return;
    }
    setSaving(true);
    setError(null);
    setErrorCode(null);
    try {
      const { profile: saved } = await saveBeatProfile(trimmed);
      setProfile(saved);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      await refreshMatches();
    } catch (err) {
      setError(err.message || 'Failed to save');
      setErrorCode(err.code || err.payload?.code || null);
    } finally {
      setSaving(false);
    }
  }, [text, t, refreshMatches]);

  const handleDelete = useCallback(async () => {
    if (!profile) return;
    setDeleting(true);
    try { await deleteBeatProfile(); }
    finally {
      setProfile(null);
      setMatches([]);
      setText('');
      setDeleting(false);
    }
  }, [profile]);

  return (
    <section className="account-section beat-section" data-testid="beat-section">
      <header className="account-section-head">
        <h2>{t('beat.title')}</h2>
        <p className="account-section-sub">{t('beat.subtitle')}</p>
      </header>

      <div className="beat-editor">
        <textarea
          className="beat-editor-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('beat.placeholder')}
          rows={4}
          maxLength={2000}
          data-testid="beat-textarea"
        />
        <div className="beat-editor-meta mono micro">
          {profile?.updatedAt && (
            <span>{t('beat.lastRefreshed', { relative: relative(profile.updatedAt) })}</span>
          )}
          {savedFlash && <span style={{ color: 'var(--sev-green)' }}> · {t('beat.saved')}</span>}
        </div>
        <div className="beat-editor-actions">
          <button
            type="button"
            className="btn primary"
            onClick={handleSave}
            disabled={saving}
            data-testid="beat-save"
          >
            <Save size={11} aria-hidden /> {saving ? t('beat.saving') : t('beat.save')}
          </button>
          {profile && (
            <button
              type="button"
              className="btn"
              onClick={handleDelete}
              disabled={deleting}
              data-testid="beat-delete"
            >
              <Trash2 size={11} aria-hidden /> {deleting ? t('beat.deleting') : t('beat.delete')}
            </button>
          )}
        </div>
        {error && (
          <div className="beat-error" role="alert" data-testid="beat-error">
            <AlertTriangle size={12} aria-hidden />
            <span>{errorCode === 'AI_NOT_CONFIGURED' ? t('beat.errorNotConfiguredBody') : error}</span>
          </div>
        )}
      </div>

      {profile && (
        <div className="beat-matches">
          <h3 className="account-subhead">{t('beat.matchesHeading')}</h3>
          {matches.length === 0 ? (
            <div className="beat-matches-empty mono micro">{t('beat.matchesEmpty')}</div>
          ) : (
            <ul className="beat-matches-list">
              {matches.map((m) => (
                <li key={m.articleId} className="beat-match" data-testid={`beat-match-${m.articleId}`}>
                  <div className="beat-match-head">
                    {m.eventId ? (
                      <Link to={`/event/${encodeURIComponent(m.eventId)}`} className="beat-match-title">
                        {m.title}
                      </Link>
                    ) : (
                      <a href={m.url || '#'} target="_blank" rel="noreferrer noopener" className="beat-match-title">
                        {m.title} <ExternalLink size={10} aria-hidden />
                      </a>
                    )}
                    <span className="mono micro beat-match-score">
                      {t('beat.matchSimilarity', { score: Math.round(m.similarity * 100) })}
                    </span>
                  </div>
                  <div className="mono micro beat-match-meta">
                    {m.source}{m.region ? ` · ${m.region}` : ''}{m.publishedAt ? ` · ${relative(m.publishedAt)}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!profile && !text && (
        <div className="beat-empty mono micro">{t('beat.emptyBody')}</div>
      )}
    </section>
  );
}
