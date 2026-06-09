/* Shared page shell: theme persistence, top bar, toast, switch, plan cards */
import React from "react";
import { Link } from "react-router-dom";
import { MAPR } from "./data.js";
import { Icons } from "./icons.jsx";
const { useState: uSP, useEffect: uEP, useCallback: uCP } = React;

function usePageTheme() {
  const [theme, setTheme] = uSP(() => localStorage.getItem("mapr-theme") || "light");
  const [headfont] = uSP(() => localStorage.getItem("mapr-headfont") || "serif");
  uEP(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-headfont", headfont);
    localStorage.setItem("mapr-theme", theme);
  }, [theme, headfont]);
  return [theme, setTheme];
}

function useToasts() {
  const [toasts, setToasts] = uSP([]);
  const toast = uCP((msg) => {
    const id = Math.random();
    setToasts((p) => [...p, { id, msg }]);
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 2600);
  }, []);
  const node = (
    <div className="toast-wrap">
      {toasts.map((x) => <div className="toast" key={x.id}><Icons.Check size={15} /> {x.msg}</div>)}
    </div>
  );
  return [toast, node];
}

function Switch({ on, onClick }) {
  return <button className={"switch" + (on ? " on" : "")} onClick={onClick}><span className="knob" /></button>;
}

function PageBar({ theme, setTheme, tabs, active, onTab, back = "/", user }) {
  const a = MAPR.account;
  return (
    <header className="pbar">
      <Link className="pbar-brand" to={back} style={{ textDecoration: "none", color: "inherit" }}>
        <span className="pbar-mark"><Icons.Compass size={18} /></span>
        <span className="pbar-name"><span className="nm">mapr</span><span className="sub">Standing Watch</span></span>
      </Link>
      <Link className="pbar-back" to={back}><Icons.ArrowLeft size={15} /> Console</Link>
      <div className="pbar-spacer" />
      {tabs && tabs.map((t) => (
        <button key={t.k} className={"pbar-tab" + (active === t.k ? " on" : "")} onClick={() => onTab(t.k)}>
          <t.icon size={15} /> <span className="pbar-tablabel">{t.label}</span>
        </button>
      ))}
      <button className="pbar-theme" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
        {theme === "light" ? <Icons.Moon size={17} /> : <Icons.Sun size={17} />}
      </button>
      {user && (
        <Link className="pbar-user" to="/account" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="avatar">{a.initials}</span>
          <span className="nm">{a.name.split(" ")[0]}</span>
          {a.role === "admin" && <span className="role-pill">ADMIN</span>}
        </Link>
      )}
    </header>
  );
}

function PlanCards({ plan, onUpgrade }) {
  const free = [
    [true, "Bidirectional map↔chat scoping (Context Stack)"],
    [true, "Investigation cards + computed source-strength"],
    [true, "Frozen, reproducible citations"],
    [true, "Create watches + in-app NEW-since-baseline markers"],
    [true, "Computed Trends & Entities"],
    [false, "Baseline Diff Reports"],
    [false, "Living cases, exports, correlation tracer"],
  ];
  const pro = [
    [true, "Everything in Free, unmetered"],
    [true, "Baseline Diff Reports + scheduled email digests"],
    [true, "Unmetered standing watches & automated diffs"],
    [true, "Living cases — map-restoring, exportable"],
    [true, "Correlation tracer & escalation chronology"],
    [true, "Shared boards (share + fork)"],
    [true, "Self-hosted — every query stays on your box"],
  ];
  return (
    <div className="planrow">
      <div className="plan">
        <h3>Free</h3>
        <div className="price">$0<small> / forever</small></div>
        <div className="tag-line">Prove the corpus, map & provenance are real.</div>
        <ul>{free.map(([on, t], i) => <li key={i} className={on ? "" : "muted"}>{on ? <Icons.Check size={15} /> : <Icons.Lock size={15} />}<span>{t}</span></li>)}</ul>
        <button className="plan-cta btn-ghost" disabled style={{ opacity: .6 }}>{plan === "active" ? "Included" : "Current plan"}</button>
      </div>
      <div className="plan pro">
        <h3>Pro</h3>
        <div className="price">$39<small> / mo</small></div>
        <div className="tag-line">Persistence, automation & sovereignty.</div>
        <ul>{pro.map(([on, t], i) => <li key={i}><Icons.Check size={15} /><span>{t}</span></li>)}</ul>
        <button className="plan-cta btn-ink" onClick={onUpgrade}>{plan === "active" ? "Manage subscription" : "Upgrade to Pro"}</button>
      </div>
    </div>
  );
}

export { usePageTheme, useToasts, Switch, PageBar, PlanCards };
