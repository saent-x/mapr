import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useAction, useMutation, useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { anyApi } from "convex/server";

function SignInCard() {
  const { signIn } = useAuthActions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [flow, setFlow] = useState("signIn");
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await signIn("password", { email, password, flow });
    } catch (err) {
      setError(String(err?.message || err));
    }
  };
  return (
    <div className="card">
      <h2>Sign in</h2>
      <form className="field" onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@agency.gov" autoComplete="email" />
        <input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min 8 chars)" autoComplete={flow === "signUp" ? "new-password" : "current-password"} style={{ marginTop: 8 }} />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn primary" type="submit">{flow === "signUp" ? "Create account" : "Sign in"}</button>
          <button className="btn" type="button" onClick={() => setFlow((f) => (f === "signUp" ? "signIn" : "signUp"))}>
            {flow === "signUp" ? "Have an account? Sign in" : "Create an account"}
          </button>
        </div>
        {error && <span className="err" style={{ fontSize: 12 }}>{error}</span>}
      </form>
    </div>
  );
}

const FREE_FEATURES = ["Live map + deterministic search", "10 Agent turns / 30 days", "1 watchlist", "1 saved view", "5 bookmarks"];
const PRO_FEATURES = ["200 Agent turns / 30 days", "Unlimited watchlists + alerts", "Daily briefs + what changed", "Dossiers, cases, exports", "Custom source requests"];

function FeatureList({ items }) {
  return (
    <ul className="feature-list">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}

function AccountCard() {
  const navigate = useNavigate();
  const { signOut } = useAuthActions();
  const me = useQuery(anyApi.users.me, {});
  const quota = useQuery(anyApi.qa.quotaStatus, {});
  const checkout = useAction(anyApi.billing.createCheckout);
  const portal = useAction(anyApi.billing.createPortal);
  const updateProfile = useMutation(anyApi.users.updateProfile);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(me?.name ?? "");

  const go = async (fn) => {
    setBusy(true);
    try {
      const { url } = await fn();
      window.location.href = url;
    } catch (err) {
      setBusy(false);
      alert(String(err?.message || err));
    }
  };

  return (
    <>
      <div className="card">
        <h2>Account</h2>
        <div className="event-meta">
          <span>{me?.email}</span>
          <span>plan: {me?.isPro ? "PRO" : "FREE"}</span>
          {me?.role === "admin" && <span className="ok">ADMIN</span>}
        </div>
        <div className="field">
          <label>Display name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Analyst name" />
          <button className="btn" style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={() => updateProfile({ name })}>
            Save
          </button>
        </div>
        {quota && (
          <p className="event-summary">
            {quota.unlimited
              ? <>QA usage: <b>{quota.used}</b> this period (admin · unlimited).</>
              : <>QA usage: <b>{quota.used}</b> / {quota.limit} this period ({quota.tier}).</>}
          </p>
        )}
      </div>
      <div className="card">
        <h2>Billing</h2>
        {me?.isPro ? (
          <>
            <p className="event-summary">Pro turns MAPR into a standing watchdesk: alerts, briefs, cases, exports, and custom source requests.</p>
            <FeatureList items={PRO_FEATURES} />
            <button className="btn" disabled={busy} onClick={() => go(portal)}>
              Manage billing
            </button>
          </>
        ) : (
          <>
            <p className="event-summary">Free proves the live map. Pro adds persistent monitoring and analyst-ready output.</p>
            <div className="plan-grid">
              <div>
                <div className="micro">FREE</div>
                <FeatureList items={FREE_FEATURES} />
              </div>
              <div>
                <div className="micro">PRO</div>
                <FeatureList items={PRO_FEATURES} />
              </div>
            </div>
            <button className="btn primary" disabled={busy} onClick={() => go(checkout)}>
              Upgrade to Pro
            </button>
          </>
        )}
      </div>
      <button className="btn" style={{ alignSelf: "flex-start" }} onClick={() => signOut().then(() => navigate("/"))}>
        Sign out
      </button>
    </>
  );
}

export default function AccountPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  return (
    <div className="page">
      <div className="page-narrow">
        {isLoading ? <div className="card">Loading…</div> : isAuthenticated ? <AccountCard /> : <SignInCard />}
      </div>
    </div>
  );
}
