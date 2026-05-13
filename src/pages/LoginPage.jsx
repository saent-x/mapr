import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail, ArrowRight, Loader2, AlertTriangle, Shield, Activity, Database, UserPlus, LogIn } from 'lucide-react';
import BrandMark from '../components/BrandMark';
import db from '../services/instantDb';
import { isFirstSignIn, createProfileOps } from '../utils/authUtils';

/**
 * Login page with InstantDB magic code auth flow.
 * Two steps: email input → code verification.
 * Styled in MAPR dark tactical theme.
 */
export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, isLoading: authLoading } = db.useAuth();

  // Only accept relative-path returnUrls. Reject `//evil.com`, full URLs,
  // and any value that React Router could resolve off-origin.
  const rawReturnUrl = searchParams.get('returnUrl') || '/';
  const returnUrl = (() => {
    if (typeof rawReturnUrl !== 'string' || !rawReturnUrl.startsWith('/')) return '/';
    if (rawReturnUrl.startsWith('//') || rawReturnUrl.startsWith('/\\')) return '/';
    return rawReturnUrl;
  })();
  const isSignup = location.pathname === '/signup';
  const alternatePath = isSignup ? '/login' : '/signup';
  const alternateTo = `${alternatePath}?returnUrl=${encodeURIComponent(returnUrl)}`;
  const AuthModeIcon = isSignup ? UserPlus : LogIn;

  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  // If already authenticated, redirect immediately
  useEffect(() => {
    if (user && !authLoading) {
      navigate(returnUrl, { replace: true });
    }
  }, [user, authLoading, navigate, returnUrl]);

  const handleSendCode = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;

    setSending(true);
    setError('');

    try {
      await db.auth.sendMagicCode({ email: email.trim() });
      setStep('code');
    } catch (err) {
      setError(err.body?.message || err.message || t('auth.sendError'));
    } finally {
      setSending(false);
    }
  };

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;

    setVerifying(true);
    setError('');

    try {
      const result = await db.auth.signInWithMagicCode({
        email: email.trim(),
        code: code.trim(),
      });

      // On first sign-in, create user profile
      if (isFirstSignIn(result)) {
        await db.transact(createProfileOps(db.tx, result.user.id, email.trim()));
      }

      setVerifying(false);
      // Navigate handled by the useEffect above when user state updates
    } catch (err) {
      setError(err.body?.message || err.message || t('auth.codeError'));
      setVerifying(false);
    }
  };

  const handleBackToEmail = () => {
    setStep('email');
    setCode('');
    setError('');
  };

  // Show loading spinner while checking auth state
  if (authLoading) {
    return (
      <div className="login-page" data-testid="login-loading">
        <div className="login-card login-card-loading">
          <Loader2 className="login-spinner" size={32} />
        </div>
      </div>
    );
  }

  return (
    <div className="login-page" data-testid="login-page">
      <div className="login-shell">
        <aside className="login-intel-panel" aria-label={t('auth.loginTitle')}>
          <div className="login-brand-row">
            <BrandMark className="login-brand-mark" size={22} />
            <div>
              <p className="login-kicker">MAPR ACCESS</p>
              <h1 className="login-brand-title">MAPR</h1>
            </div>
          </div>
          <p className="login-intel-copy">
            {t('auth.secureAccess', 'Secure access for live intelligence workflows, saved views, alerts, and account controls.')}
          </p>
          <div className="login-signal-grid" aria-hidden="true">
            <div className="login-signal-card">
              <Activity size={14} />
              <span>LIVE OPS</span>
            </div>
            <div className="login-signal-card">
              <Database size={14} />
              <span>SYNCED DATA</span>
            </div>
            <div className="login-signal-card">
              <Shield size={14} />
              <span>PRIVATE VIEWS</span>
            </div>
          </div>
        </aside>

        <div className="login-card">
          <div className="login-header">
            <div className="login-mode-badge">
              <AuthModeIcon size={13} aria-hidden />
              <span>{isSignup ? t('auth.signUp') : t('auth.signIn')}</span>
            </div>
            <h2 className="login-title">{isSignup ? t('auth.signupTitle') : t('auth.loginTitle')}</h2>
            <p className="login-subtitle">
              {isSignup ? t('auth.signupSubtitle') : t('auth.loginSubtitle')}
            </p>
          </div>

          {error && (
            <div className="login-error" role="alert">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          {step === 'email' ? (
            <form className="login-form" onSubmit={handleSendCode}>
              <label className="login-label" htmlFor="login-email">
                <Mail size={14} />
                {t('auth.emailLabel')}
              </label>
              <input
                id="login-email"
                className="login-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                required
                autoFocus
                disabled={sending}
                aria-label="Email address"
                data-testid="login-email-input"
              />
              <button
                type="submit"
                className="login-btn login-btn-primary"
                disabled={sending || !email.trim()}
                data-testid="login-send-code-btn"
              >
                {sending ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    {t('auth.sending')}
                  </>
                ) : (
                  <>
                    {t('auth.sendCode')}
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>
          ) : (
            <form className="login-form" onSubmit={handleVerifyCode}>
              <p className="login-code-sent">
                {t('auth.codeSent', { email })}
              </p>
              <label className="login-label" htmlFor="login-code">
                {t('auth.codeLabel')}
              </label>
              <input
                id="login-code"
                className="login-input login-code-input"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="000000"
                required
                autoFocus
                disabled={verifying}
                aria-label="Verification code"
                data-testid="login-code-input"
                maxLength={8}
              />
              <button
                type="submit"
                className="login-btn login-btn-primary"
                disabled={verifying || !code.trim()}
                data-testid="login-verify-code-btn"
              >
                {verifying ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    {t('auth.verifying')}
                  </>
                ) : (
                  <>
                    {t('auth.verifyCode')}
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
              <button
                type="button"
                className="login-btn login-btn-ghost"
                onClick={handleBackToEmail}
                disabled={verifying}
              >
                {t('auth.backToEmail')}
              </button>
            </form>
          )}

          <p className="login-footer-text">
            {isSignup ? t('auth.signupFooter') : t('auth.loginFooter')}
          </p>
          <p className="login-switch-text">
            {isSignup ? t('auth.hasAccount') : t('auth.noAccount')}{' '}
            <Link className="login-switch-link" to={alternateTo}>
              {isSignup ? t('auth.signIn') : t('auth.signUp')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
