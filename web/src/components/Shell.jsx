import { Link, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { anyApi } from "convex/server";
import { MenuIco, MapIco, GlobeIco, TrendsIco, EntitiesIco, IntelIco, WorkspaceIco, ThemeIco } from "./icons.jsx";
import { useTheme, toggleTheme } from "../theme.js";

const NAV = [
  { to: "/", icon: MapIco, label: "Map" },
  { to: "/intel", icon: IntelIco, label: "Intel" },
  { to: "/trends", icon: TrendsIco, label: "Trends" },
  { to: "/entities", icon: EntitiesIco, label: "Entities" },
  { to: "/workspace", icon: WorkspaceIco, label: "Workspace" },
];

const SEV_LEGEND = [
  { k: "green", label: "Low" },
  { k: "amber", label: "Elevated" },
  { k: "red", label: "Critical" },
  { k: "black", label: "Catastrophic" },
];

function StatusBar({ events }) {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19) + "Z";
  return (
    <div className="app-status">
      <span className="status-item mono tnum">{now}</span>
      <span className="status-item">
        FEED <b className="tnum">{events.length}</b> EVENTS
      </span>
      <span className="status-legend">
        {SEV_LEGEND.map((s) => (
          <span key={s.k} className="sl">
            <i style={{ background: `var(--sev-${s.k})` }} />
            {s.label}
          </span>
        ))}
      </span>
      <span className="status-right">
        <span className="status-item">
          OP <b>NOMINAL</b>
        </span>
      </span>
    </div>
  );
}

export default function Shell({ children }) {
  const loc = useLocation();
  const me = useQuery(anyApi.users.me, {});
  // Shared (deduped) with MapPage's identical subscription — one socket query.
  const events = useQuery(anyApi.events.list, {}) ?? [];
  const liveCount = events.filter((e) => Date.now() - e.publishedAt < 3_600_000).length;
  const theme = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => { setMenuOpen(false); }, [loc.pathname]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-menu" ref={menuRef}>
          <button className="menu-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu" aria-expanded={menuOpen}>
            {MenuIco}
          </button>
          {menuOpen && (
            <div className="menu-drop" role="menu">
              {NAV.map((n) => (
                <Link
                  key={n.to}
                  className="menu-item"
                  to={n.to}
                  role="menuitem"
                  data-active={n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to)}
                >
                  {n.icon}
                  {n.label}
                </Link>
              ))}
            </div>
          )}
        </div>
        <Link to="/" className="header-brand">
          <span className="brand-mark" aria-hidden>{GlobeIco}</span>
          <span className="brand-title">MAPR</span>
        </Link>
        <div className="header-page">
          <span className="hp-label">Global Feed</span>
          <span className="hp-feed">
            <span className="hp-live" /> {liveCount} LIVE · 24H
          </span>
        </div>
        <div className="header-right">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === "light" ? "Switch to dark" : "Switch to light"}
            aria-label="Toggle theme"
          >
            {ThemeIco}
          </button>
          <Link className="header-link" to="/admin" data-active={loc.pathname === "/admin"}>
            Admin
          </Link>
          <Link className="header-link" to="/account" data-active={loc.pathname === "/account"}>
            {me ? (me.isPro ? "PRO" : "Account") : "Sign in"}
          </Link>
          <span className="op-badge">
            <span className="op-dot" /> OPS NOMINAL
          </span>
        </div>
      </header>
      <main className="app-main">{children}</main>
      <StatusBar events={events} />
    </div>
  );
}
