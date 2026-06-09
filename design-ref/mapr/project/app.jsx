/* Main App — wires routing, map, pages, filters, tweaks */
const { useState: uS, useEffect: uE, useMemo: uM, useCallback: uCb } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "tactical",
  "density": "default",
  "mapStyle": "real"
}/*EDITMODE-END*/;

function applyTheme(t) {
  document.documentElement.classList.remove("theme-mono","theme-cartographic","theme-cyber");
  if (t === "mono") document.documentElement.classList.add("theme-mono");
  else if (t === "cartographic") document.documentElement.classList.add("theme-cartographic");
  else if (t === "cyber") document.documentElement.classList.add("theme-cyber");
}
function applyDensity(d) {
  document.documentElement.classList.remove("density-compact","density-roomy");
  if (d === "compact") document.documentElement.classList.add("density-compact");
  else if (d === "roomy") document.documentElement.classList.add("density-roomy");
}

function useRoute() {
  const [route, setRouteState] = uS(() => {
    const h = window.location.hash.slice(1);
    return h || localStorage.getItem("mapr_route") || "/";
  });
  uE(() => {
    const onHash = () => setRouteState(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const setRoute = (r) => {
    window.location.hash = r;
    localStorage.setItem("mapr_route", r);
    setRouteState(r);
  };
  return [route, setRoute];
}

function App() {
  const [route, setRoute] = useRoute();
  const [overlays, setOverlays] = uS({ sev: false, cov: false, geo: true });
  const [lang, setLang] = uS("ALL");
  const [tweaksOpen, setTweaksOpen] = uS(false);
  const [tweaks, setTweaks] = uS({ ...TWEAK_DEFAULTS });
  const [mapMode, setMapMode] = uS("flat"); // flat | globe
  const [activeEvent, setActiveEvent] = uS(null);
  const [openArticle, setOpenArticle] = uS(null);
  // Assistant-driven map state
  const [mapResults, setMapResults] = uS(null); // null = show full window; array = AI-filtered subset
  const [mapScope, setMapScope] = uS(null);

  // Apply theme + density
  uE(() => { applyTheme(tweaks.theme); }, [tweaks.theme]);
  uE(() => { applyDensity(tweaks.density); }, [tweaks.density]);

  // Edit mode messaging
  uE(() => {
    const onMsg = (e) => {
      const d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "__activate_edit_mode") setTweaksOpen(true);
      if (d.type === "__deactivate_edit_mode") setTweaksOpen(false);
    };
    window.addEventListener("message", onMsg);
    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Default map window: everything in the last 24h, optional language narrowing.
  const allEvents = window.MAPR_DATA.EVENTS;
  const DEFAULT_WINDOW_MS = 24 * 3600 * 1000;

  const windowEvents = uM(() => {
    const now = Date.now();
    let evs = allEvents.filter(e => (now - e.ts) <= DEFAULT_WINDOW_MS);
    if (lang !== "ALL") evs = evs.filter(e => e.lang === lang.toLowerCase());
    return evs;
  }, [allEvents, lang]);

  // What the map actually renders: AI-filtered subset if present, else the full window.
  const mapEvents = mapResults != null ? mapResults : windowEvents;

  const { Header, Sidebar, StatusBar, ArticleSheet, Ico } = window.MAPR_SHELL;
  const { FlatMap, GlobeMap } = window.MAPR_MAP;
  const { RegionPage, EntitiesPage, TrendsPage, AdminPage } = window.MAPR_PAGES;
  const { MapAssistant } = window.MAPR_ASSIST;

  const persistTweak = (k, v) => {
    const next = { ...tweaks, [k]: v };
    setTweaks(next);
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { [k]: v } }, "*");
  };

  const MapView = mapMode === "globe" ? GlobeMap : FlatMap;

  return (
    <div className="app" data-screen-label="Mapr Console">
      <Header
        lang={lang} setLang={setLang}
        route={route} setRoute={setRoute}
        tweaksOpen={tweaksOpen} setTweaksOpen={setTweaksOpen}
        feedCount={windowEvents.length}
      />
      <Sidebar route={route} setRoute={setRoute} />
      <main className="app-main">
        {route === "/" && (
          <>
            <MapView
              events={mapEvents}
              onEventClick={(e) => { setActiveEvent(e.id); setOpenArticle(e); }}
              onRegionClick={(c) => { setRoute(`/region/${c.id}`); }}
              activeEvent={activeEvent}
              layers={overlays}
              selectedIso={null}
            />
            <div className="map-controls">
              <button data-active={mapMode === "flat"} onClick={() => setMapMode("flat")} title="Flat map">{Ico.flat}</button>
              <button data-active={mapMode === "globe"} onClick={() => setMapMode("globe")} title="Globe">{Ico.globe}</button>
            </div>

            {mapScope && (
              <div className="map-result-banner">
                <span className="mrb-dot"/>
                <span className="mrb-text">{mapEvents.length} of {windowEvents.length} events</span>
                <span className="mrb-scope">{mapScope}</span>
                <button className="mrb-clear" onClick={() => { setMapResults(null); setMapScope(null); setActiveEvent(null); }}>{Ico.close} RESET</button>
              </div>
            )}

            <MapAssistant
              events={windowEvents}
              defaultWindowMs={DEFAULT_WINDOW_MS}
              onResult={(evs, scope) => { setMapResults(evs); setMapScope(scope); }}
              onOpenEvent={(e) => { setActiveEvent(e.id); setOpenArticle(e); }}
              onGotoRegion={(iso) => setRoute(`/region/${iso}`)}
            />

            {openArticle && <ArticleSheet event={openArticle} onClose={() => setOpenArticle(null)}/>}
          </>
        )}
        {route.startsWith("/region") && (
          <RegionPage iso={route.split("/")[2] || "UKR"} setRoute={setRoute} onEventClick={(e) => setOpenArticle(e)} />
        )}
        {route.startsWith("/region") && openArticle && <ArticleSheet event={openArticle} onClose={() => setOpenArticle(null)}/>}
        {route === "/entities" && <EntitiesPage setRoute={setRoute}/>}
        {route === "/trends" && <TrendsPage/>}
        {route === "/admin" && <AdminPage/>}
      </main>
      <StatusBar events={windowEvents} lang={lang}/>

      <TweaksPanel open={tweaksOpen} tweaks={tweaks} onChange={persistTweak}
        overlays={overlays} setOverlays={setOverlays}
        onClose={() => { setTweaksOpen(false); window.parent.postMessage({type:"__deactivate_edit_mode"}, "*"); }}/>
    </div>
  );
}

function TweaksPanel({ open, tweaks, onChange, overlays, setOverlays, onClose }) {
  const { Ico } = window.MAPR_SHELL;
  const LAYERS = [["geo","GRATICULE"],["sev","SEV HEAT"],["cov","COVERAGE"]];
  return (
    <div className="tweaks-panel" data-open={open}>
      <div className="panel-header">
        <span className="dot"/>TWEAKS
        <span className="spacer"/>
        <button onClick={onClose}>{Ico.close}</button>
      </div>
      <div className="tweaks-row">
        <label>Map layers</label>
        <div className="tweaks-opts">
          {LAYERS.map(([k,l]) => (
            <button key={k} className="chip" data-active={overlays[k]} onClick={()=>setOverlays({ ...overlays, [k]: !overlays[k] })}>{l}</button>
          ))}
        </div>
      </div>
      <div className="tweaks-row">
        <label>Theme</label>
        <div className="tweaks-opts">
          {[["tactical","TACTICAL"],["mono","MONO"],["cartographic","CARTO"],["cyber","CYBER"]].map(([k,l]) => (
            <button key={k} className="chip" data-active={tweaks.theme===k} onClick={()=>onChange("theme", k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="tweaks-row">
        <label>Density</label>
        <div className="tweaks-opts">
          {[["compact","COMPACT"],["default","DEFAULT"],["roomy","ROOMY"]].map(([k,l]) => (
            <button key={k} className="chip" data-active={tweaks.density===k} onClick={()=>onChange("density", k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="tweaks-row">
        <label>Map style</label>
        <div className="tweaks-opts">
          {[["real","REAL"],["graticule","GRATICULE"],["dot","DOT-MATRIX"]].map(([k,l]) => (
            <button key={k} className="chip" data-active={tweaks.mapStyle===k} onClick={()=>onChange("mapStyle", k)}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{padding:"10px 12px", fontFamily:"var(--ff-mono)", fontSize:9, letterSpacing:"0.12em", color:"var(--ink-3)", textAlign:"center"}}>
        PERSISTED VIA EDITMODE BLOCK
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
