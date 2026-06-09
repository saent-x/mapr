/* Auth — sign in / create account / verify. Map backdrop, editorial split. */
import React from "react";
import { useNavigate, Link } from "react-router-dom";
import { usePageTheme } from "./pageshell.jsx";
import { MaprMap } from "./MaprMap.jsx";
import { Icons } from "./icons.jsx";
import { MAPR } from "./data.js";
import { useAuthActions } from "@convex-dev/auth/react";
import { useEvents } from "./api/hooks.js";
const { useState: uSA, useEffect: uEA } = React;

function AuthMap() {
  // dimmed slow globe backdrop, reusing MaprMap on the live event feed
  const [theme] = usePageTheme();
  const { events } = useEvents();
  return (
    <div className="auth-map">
      <MaprMap theme={theme} mode="globe" events={events} focus={null}
        onEventClick={() => {}} hoveredId={null} dimmed={true} />
      <div className="auth-map-veil" />
    </div>
  );
}

function StrengthDots({ pw }) {
  const score = Math.min(4, (pw.length >= 8 ? 1 : 0) + (/[A-Z]/.test(pw) ? 1 : 0) + (/[0-9]/.test(pw) ? 1 : 0) + (/[^A-Za-z0-9]/.test(pw) ? 1 : 0));
  const label = ["", "weak", "fair", "good", "strong"][score];
  return (
    <div className="pw-strength">
      <div className="pw-dots">{[0,1,2,3].map(i => <i key={i} className={i < score ? "on s" + score : ""} />)}</div>
      {pw && <span className="pw-label">{label}</span>}
    </div>
  );
}

function AuthPage() {
  const [theme, setTheme] = usePageTheme();
  const [mode, setMode] = uSA("signin");     // signin | signup | sent
  const [email, setEmail] = uSA("");
  const [pw, setPw] = uSA("");
  const [name, setName] = uSA("");
  const [busy, setBusy] = uSA(false);
  const [error, setError] = uSA(null);
  const navigate = useNavigate();
  const { signIn } = useAuthActions();

  const submit = async (e) => {
    e && e.preventDefault();
    if (!email.trim() || !pw) { setError("Enter your email and password."); return; }
    setBusy(true); setError(null);
    try {
      // Convex Auth Password provider — no email transport, so signUp creates
      // the account and signs in immediately (admin granted via ADMIN_EMAILS).
      await signIn("password", {
        email: email.trim(),
        password: pw,
        flow: mode === "signup" ? "signUp" : "signIn",
        ...(mode === "signup" && name.trim() ? { name: name.trim() } : {}),
      });
      navigate("/");
    } catch (err) {
      setBusy(false);
      const msg = String(err?.message || err || "");
      setError(
        mode === "signup"
          ? (/exist|already|taken/i.test(msg) ? "An account with that email already exists — sign in instead." : "Could not create the account. Use a password of at least 8 characters.")
          : (/invalid|password|credential|not found/i.test(msg) ? "Email or password is incorrect." : "Sign-in failed. Check your details and try again."),
      );
    }
  };

  const githubUnavailable = () => setError("GitHub sign-in isn't configured on this instance. Use email + password.");

  return (
    <div className="auth">
      <AuthMap />

      {/* left editorial rail */}
      <aside className="auth-rail">
        <Link className="auth-brand" to="/">
          <span className="pbar-mark"><Icons.Compass size={19} /></span>
          <span className="pbar-name"><span className="nm">mapr</span><span className="sub">Standing Watch</span></span>
        </Link>
        <div className="auth-pitch">
          <span className="eyebrow">Self-hosted OSINT watchdesk</span>
          <h1 className="serif">It watches the world when you don't — and remembers what changed.</h1>
          <p>Ask in plain English, point at the map, and get a source-cited intelligence product back — over a corpus you own, watch over time, and can defend.</p>
        </div>
        <div className="auth-signals">
          {MAPR.signals.slice(0, 3).map((s) => (
            <div className={"auth-sig tier-" + s.tier} key={s.id}>
              <span className="auth-sig-dot" />
              <span className="auth-sig-txt"><b>{s.scope}</b> · {s.text}</span>
              <span className="auth-sig-age mono">{MAPR.ago(s.min)}</span>
            </div>
          ))}
          <div className="auth-signals-foot mono">● live · computed over the owned corpus</div>
        </div>
      </aside>

      {/* right auth card */}
      <main className="auth-stage">
        <button className="auth-theme" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
          {theme === "light" ? <Icons.Moon size={17} /> : <Icons.Sun size={17} />}
        </button>

        {mode === "sent" ? (
          <div className="auth-card">
            <div className="auth-sent-ic"><Icons.Mail size={26} /></div>
            <h2 className="serif">Check your email</h2>
            <p className="auth-sub">We sent a verification link to <b>{email || "you"}</b>. Click it to activate your watchdesk — the link is valid for 30 minutes.</p>
            <button className="btn btn-primary btn-full" onClick={() => navigate("/")}>
              Continue to console <Icons.ArrowRt size={16} />
            </button>
            <button className="auth-link" onClick={() => setMode("signin")}>← Back to sign in</button>
            <div className="auth-resend">Didn't get it? <button onClick={() => {}}>Resend link</button> · check spam</div>
          </div>
        ) : (
          <div className="auth-card">
            <div className="auth-tabs">
              <button className={mode === "signin" ? "on" : ""} onClick={() => { setMode("signin"); setError(null); }}>Sign in</button>
              <button className={mode === "signup" ? "on" : ""} onClick={() => { setMode("signup"); setError(null); }}>Create account</button>
            </div>
            <h2 className="serif">{mode === "signin" ? "Welcome back" : "Start watching"}</h2>
            <p className="auth-sub">{mode === "signin" ? "Sign in to your instance to resume your watches and cases." : "Create an account on this self-hosted instance. No data leaves the box."}</p>

            {error && <div className="auth-error" role="alert"><Icons.Alert size={14} /> <span>{error}</span></div>}

            <div className="auth-oauth">
              <button className="btn btn-outline btn-full" type="button" onClick={githubUnavailable}><Icons.Github size={16} /> Continue with GitHub</button>
            </div>
            <div className="auth-or"><span>or with email</span></div>

            <form onSubmit={submit}>
              {mode === "signup" && (
                <div className="field">
                  <label>Full name</label>
                  <div className="inp-icon"><Icons.User /><input className="inp" placeholder="Dana Okonkwo" value={name} onChange={(e) => setName(e.target.value)} /></div>
                </div>
              )}
              <div className="field">
                <label>Email</label>
                <div className="inp-icon"><Icons.Mail /><input className="inp" type="email" placeholder="you@org.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
              </div>
              <div className="field">
                <label>Password {mode === "signin" && <a className="field-link" href="#" onClick={(e) => e.preventDefault()}>Forgot?</a>}</label>
                <div className="inp-icon"><Icons.Key /><input className="inp" type="password" placeholder="••••••••" value={pw} onChange={(e) => setPw(e.target.value)} required /></div>
                {mode === "signup" && <StrengthDots pw={pw} />}
              </div>
              <button className="btn btn-primary btn-full" type="submit" disabled={busy}>
                {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
                {!busy && <Icons.ArrowRt size={16} />}
              </button>
            </form>

            <div className="auth-sov">
              <Icons.Lock size={13} />
              <span>Self-hosted · queries never touch a third-party API</span>
            </div>
          </div>
        )}
        <div className="auth-foot">mapr 0.9.2 · {mode === "signup" ? "by creating an account you accept the instance terms" : "secured by your instance"}</div>
      </main>
    </div>
  );
}

export default AuthPage;
