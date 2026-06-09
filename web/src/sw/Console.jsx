/* mapr Console — orchestrates map + composer + cards + drawers */
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { MAPR } from "./data.js";
import { Icons } from "./icons.jsx";
import { MaprMapLazy } from "./MaprMapLazy.jsx";
import { InvestigationCard, TrendsCard, ChangeReportCard, DossierCard } from "./cards.jsx";
import { TimeScrubber, FeedsDrawer, CaseCard } from "./features.jsx";
import { SignalsDrawer, CasesDrawer, WatchesDrawer, EntitiesDrawer, AccountModal, ColdOpen } from "./drawers.jsx";
import { useEvents, useInvestigation, useMe, useBilling, useSignals, useWatchActions, useCaseActions } from "./api/hooks.js";
import { focusForIso as focusForIsoIn, buildSignals } from "./api/adapters.js";
const { useState: uS, useEffect: uE, useRef: uR, useCallback: uC } = React;

function useTweaks(defaults) {
  const [t, setT] = uS(() => {
    let saved = {};
    let themeOverride = null;
    try { saved = JSON.parse(localStorage.getItem("mapr-tweaks") || "null") || {}; } catch (e) { /* ignore */ }
    // mapr-theme is the shared source of truth across the console and the
    // standalone pages, so a theme change on either surface persists everywhere.
    try { themeOverride = localStorage.getItem("mapr-theme"); } catch (e) { /* ignore */ }
    return { ...defaults, ...saved, ...(themeOverride ? { theme: themeOverride } : {}) };
  });
  const setTweak = uC((k, v) => setT((p) => {
    const n = { ...p, [k]: v };
    try { localStorage.setItem("mapr-tweaks", JSON.stringify(n)); if (k === "theme") localStorage.setItem("mapr-theme", v); } catch (e) {}
    return n;
  }), []);
  return [t, setTweak];
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "headfont": "serif",
  "mapStyle": "flat",
  "composer": "center"
}/*EDITMODE-END*/;

let _cid = 0;
function Console() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [drawer, setDrawer] = uS(null);          // signals|cases|watches|entities
  const [modal, setModal] = uS(false);
  const [cold, setCold] = uS(true);
  const me = useMe();
  const isPro = !!me?.isPro;
  const billing = useBilling();
  const watchActions = useWatchActions();
  const caseActions = useCaseActions();
  const [chips, setChips] = uS([]);
  const [thread, setThread] = uS([]);
  const [threadOpen, setThreadOpen] = uS(true);
  const [pending, setPending] = uS(false);
  const [picked, setPicked] = uS(new Set());
  const [hoveredId, setHoveredId] = uS(null);
  const [focus, setFocus] = uS(null);
  const [text, setText] = uS("");
  const [toasts, setToasts] = uS([]);
  const [rewind, setRewind] = uS(null);     // #4 time-scrubber threshold (null = live)
  const [scrubOpen, setScrubOpen] = uS(false);
  const [menuOpen, setMenuOpen] = uS(false);
  const [composerPulse, setComposerPulse] = uS(false);

  const focusComposer = uC(() => {
    setCold(false);
    setComposerPulse(true);
    setTimeout(() => {
      if (taRef.current) { taRef.current.focus(); taRef.current.scrollIntoView ? null : null; }
    }, 60);
    setTimeout(() => setComposerPulse(false), 900);
  }, []);
  const threadRef = uR(null);
  const taRef = uR(null);

  // Live event feed from the self-hosted Convex backend (reactive). A ref keeps
  // the latest events available to memoized handlers without dep churn.
  const { events: liveEvents, loading: eventsLoading } = useEvents();
  // Distinguish the three first-load states for on-brand topbar/legend chrome:
  // loading (first fetch in flight), empty (loaded, nothing in window), live.
  const eventsEmpty = !eventsLoading && liveEvents.length === 0;
  const eventsRef = uR([]);
  eventsRef.current = liveEvents;
  const focusForIso = (iso2) => focusForIsoIn(iso2, eventsRef.current);
  const navigate = useNavigate();
  const { run: runInvestigation, isAuthenticated } = useInvestigation();

  // Real computed signals (anomalies + fired watches) — drives the badge + ticker.
  const { anomalies: sigAnoms, fired: sigFired } = useSignals();
  const signals = buildSignals(sigAnoms, sigFired);

  // apply theme + headline font to root
  uE(() => {
    document.documentElement.setAttribute("data-theme", t.theme);
    document.documentElement.setAttribute("data-headfont", t.headfont);
    try { localStorage.setItem("mapr-theme", t.theme); } catch (e) {}
  }, [t.theme, t.headfont]);

  uE(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [thread, pending]);

  const toast = uC((msg) => {
    const id = ++_cid;
    setToasts((p) => [...p, { id, msg }]);
    setTimeout(() => setToasts((p) => p.filter(x => x.id !== id)), 2600);
  }, []);

  // Real Stripe checkout (upgrade) — the paywall is server-enforced; this is the
  // purchase path the upsell modal and Pro-gated actions route to.
  const goPro = uC(async () => {
    try {
      const { url } = await billing.checkout({});
      window.location.href = url;
    } catch (e) {
      const m = String(e?.message || e || "");
      toast(/STRIPE|not configured/i.test(m) ? "Billing isn't configured on this instance yet." : "Could not start checkout.");
    }
  }, [billing, toast]);

  // Create a standing watch from the current region scope — freezes a baseline.
  const createWatch = uC(async () => {
    if (!isAuthenticated) { toast("Create a free account to watch a scope"); navigate("/signin"); return; }
    const rg = chips.find((c) => c.k === "REGION" && c.iso2);
    if (!rg) { toast("Investigate or select a region first, then watch it."); return; }
    try {
      await watchActions.create({ type: "region", value: rg.iso2, label: rg.v });
      toast("Watch created — baseline frozen");
      setDrawer("watches");
    } catch (e) {
      const m = String(e?.message || e || "");
      if (/FEATURE_LIMIT_WATCHLIST/i.test(m)) { toast("Free plan allows 1 watch — upgrade for unlimited"); setModal(true); }
      else toast("Could not create the watch.");
    }
  }, [isAuthenticated, chips, watchActions, toast, navigate]);

  // Promote the pinned evidence rows (from the open investigations) into a new
  // case (Pro). Falls back to an empty case when nothing is pinned.
  const promoteToCase = uC(async () => {
    if (!isAuthenticated) { navigate("/signin"); return; }
    const rg = chips.find((c) => c.k === "REGION");
    const title = rg ? `${rg.v} — investigation` : "Pinned investigation";
    const pinned = [];
    for (const card of thread) {
      if (card.type === "investigation" && Array.isArray(card.data?.evidence)) {
        for (const ev of card.data.evidence) if (picked.has(ev.id)) pinned.push(ev);
      }
    }
    try {
      const res = await caseActions.create({ title });
      const caseId = res?.id ?? res;
      for (const ev of pinned) {
        await caseActions.addItem({
          caseId, type: "event", eventId: ev.eventId || undefined,
          title: ev.title, summary: ev.snippet, source: ev.source, url: ev.url || undefined,
          region: ev.iso2 || undefined, severity: ev.score,
        });
      }
      toast(pinned.length ? `${pinned.length} row${pinned.length === 1 ? "" : "s"} pinned to a new case` : "Case created");
      setPicked(new Set());
      setDrawer("cases");
    } catch (e) {
      const m = String(e?.message || e || "");
      if (/FEATURE_LOCKED|FEATURE_LIMIT_CASES/i.test(m)) { toast("Cases are a Pro feature — upgrade to open a case"); setModal(true); }
      else toast("Could not create the case.");
    }
  }, [isAuthenticated, chips, thread, picked, caseActions, toast, navigate]);

  const addChip = uC((chip) => {
    setChips((p) => {
      const id = chip.k + ":" + chip.v;
      if (p.some(c => c.id === id)) return p;
      return [...p, { ...chip, id }];
    });
  }, []);
  const removeChip = (id) => setChips((p) => p.filter(c => c.id !== id));

  // Worst severity tier among live events in a region (colors the scope chip).
  const worstTierForIso = (iso2) => {
    const order = { black: 0, red: 1, amber: 2, green: 3 };
    const evs = eventsRef.current.filter((e) => e.iso2 === iso2);
    if (!evs.length) return null;
    return evs.reduce((w, e) => (order[e.tier] < order[w] ? e.tier : w), "green");
  };

  // The real investigation: deterministic scope/facets + grounded cited
  // generation over the owned corpus (qwen2.5:3b), gated on a real account.
  const runQuery = uC(async (q) => {
    if (!q.trim()) return;
    setCold(false);
    if (!isAuthenticated) {
      toast("Create a free account to investigate");
      navigate("/signin");
      return;
    }
    setText("");
    const regionChip = chips.find((c) => c.k === "REGION");
    const eventChips = chips.filter((c) => c.k === "EVENT");
    addChip({ k: "TIME", v: "7d" });
    setThreadOpen(true);
    setPending(true);
    try {
      const ans = await runInvestigation(q, {
        region: regionChip?.iso2,
        eventIds: eventChips.map((c) => c.eventId).filter(Boolean),
      });
      if (ans.regionIso && !regionChip) {
        addChip({ k: "REGION", v: ans.scope.region, iso2: ans.regionIso, tier: worstTierForIso(ans.regionIso) || "amber", tiered: true });
        setFocus(focusForIso(ans.regionIso));
      }
      setThread((p) => [...p, { id: ++_cid, type: "investigation", data: ans }]);
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (/QA_QUOTA_EXCEEDED|quota/i.test(msg)) { toast("Monthly question limit reached — upgrade for unmetered"); setModal(true); }
      else if (/UNAUTHENTICATED/i.test(msg)) { navigate("/signin"); }
      else { toast("Investigation failed — please try again"); }
    } finally {
      setPending(false);
    }
  }, [addChip, chips, isAuthenticated, runInvestigation, navigate, toast]);

  const pushCard = (card) => { setCold(false); setThreadOpen(true); setThread((p) => [...p, { id: ++_cid, ...card }]); };

  const onEventClick = uC((ev) => {
    setCold(false);
    addChip({ k: "EVENT", v: ev.title.length > 26 ? ev.title.slice(0, 26) + "…" : ev.title, iso2: ev.iso2, tier: ev.tier, tiered: true });
    setFocus(focusForIso(ev.iso2));
    if (taRef.current) taRef.current.focus();
  }, [addChip]);

  const onPick = uC((id) => {
    setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const onMove = uC((kind) => {
    if ((kind === "brief" || kind === "export") && !isPro) { setModal(true); return; }
    if (kind === "watch") { createWatch(); }
    else if (kind === "case") { promoteToCase(); }
    else if (kind === "alert") { toast("Alert set — we'll push the diff"); }
    else if (kind === "openmap") { toast("New events highlighted on map"); }
    else if (kind === "share") { toast("Share link copied — audit trail travels with it"); }
    else if (kind === "rebaseline") { toast("Baseline re-snapshotted"); }
    else if (kind === "correlate") { if (!isPro) setModal(true); else toast("Correlation arcs drawn"); }
    else toast("Done");
  }, [isPro, createWatch, promoteToCase, toast]);

  const onChangeReport = uC((w) => { setDrawer(null); pushCard({ type: "change", data: w }); }, []);
  const onDossier = uC((e) => { setDrawer(null); pushCard({ type: "dossier", data: e }); setFocus(focusForIso(e.regions?.[0])); }, []);
  const onOpenCase = uC((c) => { setDrawer(null); pushCard({ type: "case", data: c.id }); }, []);
  const onScope = uC((c) => { setDrawer(null); addChip({ k: c.kind || "REGION", v: c.label, iso2: c.iso2, tier: c.tier, tiered: !!c.tier }); setFocus(focusForIso(c.iso2)); if (taRef.current) taRef.current.focus(); }, [addChip]);

  // computed suggestions
  const suggestions = [
    { tier: "black", text: <><b>Sudan:</b> conflict signals what's driving them?</>, delta: "+240%", q: "What's driving the Sudan conflict surge — and what changed this week?" },
    { tier: "red", text: <><b>Red Sea:</b> why are shippers diverting?</>, delta: "+95%", q: "Why are shippers diverting around the Red Sea corridor this week?" },
    { tier: "red", text: <><b>Baltic:</b> cable faults — connected?</>, delta: "+110%", q: "Are the Baltic undersea cable faults connected?" },
  ];

  const placeholder = (() => {
    const ev = chips.find(c => c.k === "EVENT");
    if (ev) return "Ask about this event…";
    const rg = chips.find(c => c.k === "REGION");
    if (rg) return `Ask about ${rg.v}…`;
    return "Investigate or watch a region, event, or entity…";
  })();

  const signalsCount = signals.length;

  const spineItems = [
    { k: "search", icon: Icons.Search, label: "Investigate", onClick: focusComposer },
    { k: "signals", icon: Icons.Signals, label: "Signals", badge: signalsCount },
    { k: "cases", icon: Icons.Cases, label: "Cases" },
    { k: "watches", icon: Icons.Eye, label: "Watches" },
    { k: "entities", icon: Icons.Entities, label: "Entities" },
    { k: "feeds", icon: Icons.Layers, label: "Feeds" },
  ];

  return (
    <div className="app">
      {/* STAGE */}
      <div className="stage">
        <MaprMapLazy theme={t.theme} mode={t.mapStyle} events={liveEvents}
          focus={focus} onEventClick={onEventClick} hoveredId={hoveredId} dimmed={cold} timeThreshold={rewind} />

        {/* topbar */}
        <div className="topbar">
          <button className={"menu-btn" + (menuOpen ? " is-open" : "")} title="Menu" onClick={() => setMenuOpen(o => !o)}>
            <span className="menu-mark"><Icons.Compass size={17} /></span>
            <span className="menu-lines"><i /><i /><i /></span>
            {signalsCount > 0 && <span className="menu-badge">{signalsCount}</span>}
          </button>
          <div className="tb-pill">
            <span className="live-dot" />
            <span className="tb-status tb-status-text">
              {eventsLoading
                ? <span className="shimmer-line" style={{ display: "inline-block", width: 52, height: 9, borderRadius: 4, verticalAlign: "middle" }} />
                : eventsEmpty
                  ? <>No events · <b>24h</b></>
                  : <><b>{liveEvents.length}</b> live · <b>24h</b></>}
            </span>
          </div>
          <div className="proj-toggle">
            <button className={t.mapStyle === "flat" ? "on" : ""} onClick={() => setTweak("mapStyle", "flat")}>Flat</button>
            <button className={t.mapStyle === "globe" ? "on" : ""} onClick={() => setTweak("mapStyle", "globe")}>Globe</button>
          </div>
          <div className="tb-spacer" />
          <button className={"tb-icon" + (scrubOpen ? " on" : "")} title="Escalation rewind" onClick={() => { setScrubOpen(o => { const n = !o; if (!n) setRewind(null); return n; }); }}><Icons.Clock size={18} /></button>
          <button className="tb-icon" title="Trends" onClick={() => pushCard({ type: "trends" })}><Icons.Trend size={18} /></button>
          <button className="tb-icon" title="Refresh"><Icons.Refresh size={17} /></button>
          <button className="tb-plan" onClick={() => setModal(true)}>
            {isPro ? "Pro" : "Free"} <span className="chip-pro">{isPro ? "ACTIVE" : "UPGRADE"}</span>
          </button>
        </div>

        {/* NAV POPOVER */}
        {menuOpen && (
          <>
            <div className="menu-scrim" onClick={() => setMenuOpen(false)} />
            <div className="menu-pop">
              <div className="menu-pop-head">
                <span className="menu-pop-mark"><Icons.Compass size={16} /></span>
                <div className="menu-pop-title">
                  <span className="serif">mapr</span>
                  <span className="eyebrow">Standing Watch</span>
                </div>
              </div>
              <div className="menu-pop-list">
                {spineItems.map((it) => (
                  <button key={it.k} className={"menu-item" + (drawer === it.k ? " is-active" : "")}
                    onClick={() => { setMenuOpen(false); it.onClick ? it.onClick() : setDrawer(drawer === it.k ? null : it.k); }}>
                    <span className="menu-item-ic"><it.icon size={18} /></span>
                    <span className="menu-item-label">{it.label}</span>
                    {it.badge ? <span className="menu-item-badge">{it.badge}</span> : <Icons.Chevron size={14} className="menu-item-chev" />}
                  </button>
                ))}
                {MAPR.account.role === "admin" && (
                  <Link className="menu-item" to="/admin">
                    <span className="menu-item-ic"><Icons.Shield size={18} /></span>
                    <span className="menu-item-label">Admin</span>
                    <Icons.Chevron size={14} className="menu-item-chev" />
                  </Link>
                )}
              </div>
              <div className="menu-pop-foot">
                <button className="menu-foot-btn" onClick={() => { setMenuOpen(false); setTweak("theme", t.theme === "light" ? "dark" : "light"); }}>
                  {t.theme === "light" ? <Icons.Moon size={17} /> : <Icons.Sun size={17} />}
                  <span>{t.theme === "light" ? "Dark" : "Light"}</span>
                </button>
                <Link className="menu-foot-btn" to="/account">
                  <Icons.User size={17} />
                  <span>Account</span>
                </Link>
                <Link className="menu-foot-btn" to="/signin" title="Sign out">
                  <Icons.LogOut size={17} />
                  <span>Sign out</span>
                </Link>
              </div>
            </div>
          </>
        )}

        {/* legend — skeleton while the first event load is in flight, a clear
            empty state when the window has no events, else the tier rollup. */}
        {!scrubOpen && (
        <div className="legend">
          {eventsLoading ? (
            ["black","red","amber","green"].map(k => (
              <div className={"legend-row tier-" + k} key={k}>
                <span className="sw" />
                <span>{MAPR.TIERS[k].label}</span>
                <span className="shimmer-line" style={{ display: "inline-block", width: 14, height: 9, borderRadius: 4 }} />
              </div>
            ))
          ) : eventsEmpty ? (
            <div className="legend-row">
              {/* .n keeps the text visible (plain label spans are hidden by CSS) */}
              <span className="n" style={{ fontWeight: 500, opacity: 0.75 }}>No events in this window</span>
            </div>
          ) : (
            ["black","red","amber","green"].map(k => (
              <div className={"legend-row tier-" + k} key={k}>
                <span className="sw" />
                <span>{MAPR.TIERS[k].label}</span>
                <span className="n">{liveEvents.filter(e => e.tier === k).length}</span>
              </div>
            ))
          )}
        </div>
        )}

        {/* #4 escalation rewind scrubber */}
        {scrubOpen && <TimeScrubber threshold={rewind} onChange={setRewind} onClose={() => { setScrubOpen(false); setRewind(null); }} />}

        {/* THREAD */}
        {(thread.length > 0 || pending) && (
        <div className={"thread-zone" + (threadOpen ? "" : " collapsed")}>
          <div className="thread-head">
            <span className="th-title">
              <span className="eyebrow">Dispatches</span>
              <span className="th-count mono">{thread.length}</span>
            </span>
            <button className="th-toggle" onClick={() => setThreadOpen(o => !o)}>
              {threadOpen ? <><Icons.X size={13} /> Hide</> : <><Icons.Layers size={13} /> Show</>}
            </button>
          </div>
          <div className="thread scroll" ref={threadRef}>
            {thread.map((c) => {
              if (c.type === "investigation") return <InvestigationCard key={c.id} ans={c.data} picked={picked} onPick={onPick} onHover={setHoveredId} onMove={onMove} onEvClick={(ev)=>{setFocus(focusForIso(ev.iso2));}} />;
              if (c.type === "trends") return <TrendsCard key={c.id} onMove={onMove} />;
              if (c.type === "change") return <ChangeReportCard key={c.id} watch={c.data} onMove={onMove} />;
              if (c.type === "dossier") return <DossierCard key={c.id} entity={c.data} onMove={onMove} onHover={setHoveredId} />;
              if (c.type === "case") return <CaseCard key={c.id} caseId={c.data} onMove={onMove} onHover={setHoveredId} />;
              return null;
            })}
            {pending && (
              <div className="card"><div className="card-body" style={{ gap: 11 }}>
                <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="live-dot" /> COMPUTING DETERMINISTIC LAYER…</div>
                <div className="shimmer-line" /><div className="shimmer-line" style={{ width: "78%" }} /><div className="shimmer-line" style={{ width: "60%" }} />
              </div></div>
            )}
          </div>
        </div>
        )}
        {/* reopen pill when hidden */}
        {!threadOpen && (thread.length > 0 || pending) && (
          <button className="thread-reopen" onClick={() => setThreadOpen(true)}>
            <Icons.Layers size={15} />
            <span>{thread.length} dispatch{thread.length === 1 ? "" : "es"}</span>
            <Icons.Chevron size={13} style={{ transform: "rotate(-90deg)" }} />
          </button>
        )}

        {/* COMPOSER */}
        <div className={"composer-zone" + (t.composer === "left" ? " left" : "") + (scrubOpen ? " lifted" : "")}>
          <div className="composer">
            {chips.length > 0 && (
              <div className="ctx-stack">
                {chips.map((c) => (
                  <span key={c.id} className={"ctx-chip" + (c.tiered ? " tiered tier-" + c.tier : "")}>
                    <span className="k">{c.k}</span><span className="v">{c.v}</span>
                    <button className="x" onClick={() => removeChip(c.id)}><Icons.X size={11} /></button>
                  </span>
                ))}
                <span className="ctx-hint">scope the AI is looking at — edit before you ask</span>
              </div>
            )}
            {thread.length === 0 && !pending && (
              <div className="suggest-row">
                {suggestions.map((s, i) => (
                  <button key={i} className={"suggest tier-" + s.tier} onClick={() => runQuery(s.q)}>
                    <span className="sg-tier" />
                    <span className="sg-text">{s.text} <span className="sg-delta">{s.delta}</span></span>
                  </button>
                ))}
              </div>
            )}
            {/* input box — text only, its own container */}
            <div className={"input-shell" + (composerPulse ? " pulse" : "")}>
              <div className="input-row">
                <textarea ref={taRef} rows={1} value={text} placeholder={placeholder}
                  onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(130, e.target.scrollHeight) + "px"; }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runQuery(text); } }} />
                <button className="send-btn" disabled={!text.trim()} onClick={() => runQuery(text)} title="Send"><Icons.Send size={16} /></button>
              </div>
            </div>
            {/* bottom options — a SEPARATE bar below the input, with a gap */}
            <div className="composer-bar">
              <div className="tools-left">
                <button className="tool-btn tool-add" title="Add context"><Icons.Plus size={15} /> Add context</button>
                <button className="tool-btn on"><Icons.Map size={15} /> Map-scoped</button>
                <button className="tool-btn"><Icons.Layers size={15} /> Sources</button>
                <button className="tool-btn"><Icons.Eye size={15} /> Watch mode</button>
              </div>
              <div className="tools-right">
                <span className="cc-model mono"><span className="cc-model-dot" /> grounded · owned corpus</span>
              </div>
            </div>
            {signals.length > 0 && (
            <div className="ticker-zone ticker">
              <div className="ticker-track">
                {[...signals, ...signals].map((s, i) => (
                  <span className={"tick tier-" + s.tier} key={i} onClick={() => onScope(s.iso2 ? { label: s.scope, iso2: s.iso2, tier: s.tier } : { kind: "CATEGORY", label: s.scope, tier: s.tier })} style={{ cursor: "pointer" }}>
                    <span className="sw" /> {s.scope}: <b>{s.text}</b>
                  </span>
                ))}
              </div>
            </div>
            )}
          </div>
        </div>

        {/* mobile bottom bar */}
        <div className={"mobile-bar" + (drawer || modal ? " hidden" : "")}>
          <button className="mb-btn on"><Icons.Map size={21} /> Map</button>
          <button className="mb-btn" onClick={() => setDrawer("signals")}><Icons.Signals size={21} /><span className="badge">{signalsCount}</span> Signals</button>
          <button className="mb-btn" onClick={() => setDrawer("cases")}><Icons.Cases size={21} /> Cases</button>
          <button className="mb-btn" onClick={() => setDrawer("watches")}><Icons.Eye size={21} /> Watches</button>
          <button className="mb-btn" onClick={() => setModal(true)}><Icons.User size={21} /> You</button>
        </div>
      </div>

      {/* DRAWERS */}
      {drawer === "signals" && <SignalsDrawer onClose={() => setDrawer(null)} onScope={onScope} onChangeReport={onChangeReport} />}
      {drawer === "cases" && <CasesDrawer onClose={() => setDrawer(null)} onScope={onScope} onOpenCase={onOpenCase} picked={picked} onNewCase={promoteToCase} onPromote={promoteToCase} />}
      {drawer === "watches" && <WatchesDrawer onClose={() => setDrawer(null)} onChangeReport={onChangeReport} onScope={onScope} onNewWatch={createWatch} />}
      {drawer === "entities" && <EntitiesDrawer onClose={() => setDrawer(null)} onDossier={onDossier} />}
      {drawer === "feeds" && <FeedsDrawer onClose={() => setDrawer(null)} toast={toast} />}

      {/* MODAL */}
      {modal && <AccountModal onClose={() => setModal(false)} plan={isPro ? "pro" : "free"} onUpgrade={() => { setModal(false); goPro(); }} />}

      {/* COLD OPEN */}
      {cold && <ColdOpen onStart={runQuery} onDismiss={() => setCold(false)} />}

      {/* TOASTS */}
      <div className="toast-wrap">
        {toasts.map((x) => <div className="toast" key={x.id}><Icons.Check size={15} /> {x.msg}</div>)}
      </div>
    </div>
  );
}

export default Console;
