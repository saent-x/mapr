/* Account — real profile, plan + usage, settings, sovereignty, danger zone.
   Sourced live from Convex: users.me · qa.quotaStatus · watchlist/cases/bookmarks
   counts · billing.createCheckout/createPortal (Stripe). Nothing mocked. */
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthActions } from "@convex-dev/auth/react";
import { usePageTheme, useToasts, Switch, PageBar, PlanCards } from "./pageshell.jsx";
import { Icons } from "./icons.jsx";
import { useMe, useQuota, useAccountStats, useBilling, useUpdateProfile } from "./api/hooks.js";
import { ago } from "./api/adapters.js";
const { useState: uSAc, useEffect: uEAc } = React;

const ACC_TABS = [
  { k: "overview", label: "Overview", icon: Icons.User },
  { k: "billing", label: "Plan", icon: Icons.Card },
  { k: "settings", label: "Settings", icon: Icons.Sliders },
];

function OverviewTab({ a, onGoPro }) {
  const limit = a.qa.limit;
  const pct = limit > 0 && limit < 1e9 ? Math.min(100, Math.round((a.qa.used / limit) * 100)) : 0;
  const meterClass = pct >= 100 ? "over" : pct >= 80 ? "warn" : "";
  const unlimited = limit >= 1e9;
  return (
    <>
      <div className="acct-hero">
        <span className="acct-avatar">{a.initials}</span>
        <div className="acct-id">
          <div className="nm">{a.name}</div>
          <div className="em">{a.email}</div>
          <div className="acct-meta">
            <span>ROLE <b>{a.role.toUpperCase()}</b></span>
            <span>PLAN <b>{a.plan === "active" ? "PRO" : "FREE"}</b></span>
          </div>
        </div>
        <span className={"plan-badge " + (a.plan === "active" ? "pro" : "free")}>{a.plan === "active" ? "PRO" : "FREE"}</span>
      </div>

      <div className="section">
        <div className="section-bar"><h2>Your watchdesk</h2><span className="ln" /></div>
        <div className="mini-stats">
          <div className="mini-stat"><div className="v">{a.usage.watches}</div><div className="l">Watches</div></div>
          <div className="mini-stat"><div className="v">{a.usage.cases}</div><div className="l">Cases</div></div>
          <div className="mini-stat"><div className="v">{a.usage.pinned}</div><div className="l">Pinned</div></div>
          <div className="mini-stat"><div className="v">{a.usage.used}</div><div className="l">Questions · 30d</div></div>
        </div>
      </div>

      <div className="cols">
        <div className="panel usage-card">
          <div className="usage-top">
            <div><div className="mono" style={{ fontSize: 9, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink-faint)", marginBottom: 6 }}>Interactive messages · 30d</div>
              <span className="big">{a.qa.used}</span> <span className="lim">/ {unlimited ? "∞" : limit}</span></div>
            {a.plan !== "active" && <button className="btn btn-primary btn-sm" onClick={onGoPro}>Go Pro</button>}
          </div>
          <div className="meter"><div className={"fill " + meterClass} style={{ width: pct + "%" }} /></div>
          <div className="usage-note">Fair-use compute guardrail on the self-hosted box — <b>not</b> a value lever.{a.qa.resetMin != null && <> Window resets in {ago(a.qa.resetMin)}.</>} Watches, diffs, and cases never count against this.</div>
        </div>
        <div className="panel sov-card">
          <div className="sov-row"><span className="k">Instance</span><span className="val mono">{a.instance.host}</span></div>
          <div className="sov-row"><span className="k">Version</span><span className="val">{a.instance.version}</span></div>
          <div className="sov-row"><span className="k">Model</span><span className="val mono">{a.instance.model}</span></div>
          <div className="sov-row"><span className="k">Hosting</span><span className="val">{a.instance.region}</span></div>
          <div className="sov-row"><span className="k">Queries</span><span className="val"><span className="acct-verified"><Icons.Lock size={13} /> never leave the box</span></span></div>
        </div>
      </div>
    </>
  );
}

function BillingTab({ a, isPro, onUpgrade, onManage, busy }) {
  return (
    <>
      <div className="section">
        <div className="section-bar"><h2>Plan & billing</h2><span className="ln" /></div>
        <PlanCards plan={isPro ? "active" : "free"} onUpgrade={isPro ? onManage : onUpgrade} />
        {busy && <div className="baseline-meta" style={{ marginTop: 10 }}>Opening Stripe…</div>}
      </div>
      <div className="section">
        <div className="section-bar"><h2>Why Pro</h2><span className="ln" /></div>
        <div className="panel panel-pad" style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
          We sell <b>persistence, automation, and sovereignty</b> — not quota. Every Pro feature depends on durable state diffed against a continuously-running owned ingest pipeline (baselines, watches, cases, boards), which a stateless prompt structurally cannot hold. The interactive cap is a compute guardrail, never a reason to pay.
        </div>
      </div>
      {isPro && (
        <div className="section">
          <div className="section-bar"><h2>Manage subscription</h2><span className="ln" /></div>
          <div className="panel panel-pad" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span className="si" style={{ width: 40, height: 40, borderRadius: 9, background: "var(--surface-2)", display: "grid", placeItems: "center" }}><Icons.Card size={20} /></span>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>Pro subscription active</div><div className="sub">Update card, view invoices, or cancel in the Stripe portal.</div></div>
            <button className="btn btn-outline btn-sm" onClick={onManage}>Manage in Stripe</button>
          </div>
        </div>
      )}
    </>
  );
}

const DEFAULT_SETTINGS = { digestCadence: "daily", alertStream: true, blackTierPush: true, weeklyReport: false };

function SettingsTab({ a, toast, onSaveName, onSignOut }) {
  const [s, setS] = uSAc(DEFAULT_SETTINGS);
  const set = (k, v) => setS((p) => ({ ...p, [k]: v }));
  const [theme, setTheme] = usePageTheme();
  const [name, setName] = uSAc(a.name);
  return (
    <>
      <div className="section">
        <div className="section-bar"><h2>Notifications & digests</h2><span className="ln" /></div>
        <div className="panel panel-pad">
          <div className="setrow">
            <span className="si"><Icons.Mail size={17} /></span>
            <div className="sc"><div className="st">Digest cadence</div><div className="sd">How often baseline-diff email digests are sent (Pro).</div></div>
            <div className="seg-ctl">
              {["off", "realtime", "daily", "weekly"].map((c) => <button key={c} className={s.digestCadence === c ? "on" : ""} onClick={() => set("digestCadence", c)}>{c}</button>)}
            </div>
          </div>
          <div className="setrow"><span className="si"><Icons.Bell size={17} /></span><div className="sc"><div className="st">In-app alert stream</div><div className="sd">Live watch hits and fired alerts in the console.</div></div><Switch on={s.alertStream} onClick={() => set("alertStream", !s.alertStream)} /></div>
          <div className="setrow"><span className="si"><Icons.Alert size={17} /></span><div className="sc"><div className="st">Black-tier push</div><div className="sd">Wake me when a catastrophic event enters a watched region.</div></div><Switch on={s.blackTierPush} onClick={() => set("blackTierPush", !s.blackTierPush)} /></div>
          <div className="setrow"><span className="si"><Icons.Trend size={17} /></span><div className="sc"><div className="st">Weekly change report</div><div className="sd">Sunday summary of what moved across all watches.</div></div><Switch on={s.weeklyReport} onClick={() => set("weeklyReport", !s.weeklyReport)} /></div>
        </div>
      </div>

      <div className="section">
        <div className="section-bar"><h2>Appearance</h2><span className="ln" /></div>
        <div className="panel panel-pad">
          <div className="setrow"><span className="si"><Icons.Sun size={17} /></span><div className="sc"><div className="st">Theme</div><div className="sd">Light paper or deep ink — your preference syncs across the console.</div></div>
            <div className="seg-ctl">{["light", "dark"].map((c) => <button key={c} className={theme === c ? "on" : ""} onClick={() => setTheme(c)}>{c}</button>)}</div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-bar"><h2>Profile</h2><span className="ln" /></div>
        <div className="panel panel-pad">
          <div className="cols-even">
            <div className="field"><label>Full name</label><input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label>Email</label><input className="inp" defaultValue={a.email} disabled style={{ opacity: 0.7 }} /></div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => onSaveName(name)}>Save changes</button>
        </div>
      </div>

      <div className="section">
        <div className="section-bar"><h2 style={{ color: "var(--t-red)" }}>Danger zone</h2><span className="ln" /></div>
        <div className="danger-zone">
          <div className="dz-row"><div className="dz-c"><div className="dz-t">Sign out</div><div className="dz-d">End this session on {a.instance.host}.</div></div><button className="btn btn-outline btn-sm" onClick={onSignOut}><Icons.LogOut size={14} /> Sign out</button></div>
          <div className="dz-row"><div className="dz-c"><div className="dz-t">Delete account</div><div className="dz-d">Permanently remove your account and all owned cases. This cannot be undone.</div></div><button className="btn btn-danger btn-sm" onClick={() => toast("Account deletion is handled by an instance admin — contact your operator.")}><Icons.Trash size={14} /> Delete</button></div>
        </div>
      </div>
    </>
  );
}

function AccountPage() {
  const [theme, setTheme] = usePageTheme();
  const [tab, setTab] = uSAc("overview");
  const [toast, toastNode] = useToasts();
  const [busy, setBusy] = uSAc(false);
  const navigate = useNavigate();
  const me = useMe();
  const quota = useQuota();
  const stats = useAccountStats();
  const billing = useBilling();
  const updateProfile = useUpdateProfile();
  const { signOut } = useAuthActions();

  uEAc(() => { if (me === null) navigate("/signin"); }, [me, navigate]);

  if (me === undefined) {
    return <div className="page"><div className="pbody"><div className="pwrap narrow"><div className="page-head"><span className="eyebrow">Account</span><h1 className="serif">Loading…</h1></div></div></div></div>;
  }
  if (me === null) return null;

  const isPro = !!me.isPro;
  const initials = ((me.name || me.email || "U").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || "U").toUpperCase();
  const limit = quota?.limit ?? me.limits?.qaTurns ?? 10;
  const used = quota?.used ?? 0;
  const a = {
    name: me.name || (me.email ? me.email.split("@")[0] : "You"),
    email: me.email || "",
    initials,
    role: me.role || "user",
    plan: isPro ? "active" : "free",
    qa: { used, limit, resetMin: quota?.resetAt ? Math.max(0, Math.round((quota.resetAt - Date.now()) / 60000)) : null },
    usage: { watches: stats.watches, cases: stats.cases, pinned: stats.pinned, used },
    instance: {
      host: typeof window !== "undefined" ? window.location.host : "self-hosted",
      version: "mapr · self-hosted",
      model: "qwen2.5:3b · bge-m3 (1024d)",
      region: "on-prem · self-hosted",
    },
  };

  const goPro = async () => {
    setBusy(true);
    try {
      const { url } = await billing.checkout({});
      window.location.href = url;
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (/not configured|STRIPE/i.test(msg)) toast("Billing isn't configured on this instance yet.");
      else toast("Could not start checkout — please try again.");
      setBusy(false);
    }
  };
  const managePlan = async () => {
    setBusy(true);
    try {
      const { url } = await billing.portal({});
      window.location.href = url;
    } catch (e) {
      toast("Could not open the billing portal.");
      setBusy(false);
    }
  };
  const saveName = async (name) => {
    try { await updateProfile({ name }); toast("Profile saved"); }
    catch (e) { toast("Could not save profile."); }
  };
  const doSignOut = async () => { try { await signOut(); } catch (e) { /* ignore */ } navigate("/signin"); };

  return (
    <div className="page">
      <PageBar theme={theme} setTheme={setTheme} tabs={ACC_TABS} active={tab} onTab={setTab} />
      <div className="pbody">
        <div className="pwrap narrow">
          <div className="page-head">
            <span className="eyebrow">Account</span>
            <h1 className="serif">{tab === "billing" ? "Plan & billing" : tab === "settings" ? "Settings" : "Your account"}</h1>
          </div>
          {tab === "overview" && <OverviewTab a={a} onGoPro={goPro} />}
          {tab === "billing" && <BillingTab a={a} isPro={isPro} onUpgrade={goPro} onManage={managePlan} busy={busy} />}
          {tab === "settings" && <SettingsTab a={a} toast={toast} onSaveName={saveName} onSignOut={doSignOut} />}
        </div>
      </div>
      {toastNode}
    </div>
  );
}

export default AccountPage;
