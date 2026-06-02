import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { anyApi } from "convex/server";
import MaprMap from "../map/MaprMap.jsx";
import Composer from "../components/Composer.jsx";
import EventSheet from "../components/EventSheet.jsx";
import MapStageBoundary from "../components/MapStageBoundary.jsx";
import WorkbenchRail from "../components/WorkbenchRail.jsx";
import { CloseIco } from "../components/icons.jsx";
import { useTheme } from "../theme.js";

const DENSITIES = ["compact", "default", "roomy"];
function applyDensity(d) {
  const el = document.documentElement;
  DENSITIES.forEach((x) => el.classList.remove(`density-${x}`));
  if (d !== "default") el.classList.add(`density-${d}`);
}

export default function MapPage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const events = useQuery(anyApi.events.list, {}) ?? [];
  const fullCoverage = useQuery(anyApi.events.regionCoverage, {}) ?? [];
  const me = useQuery(anyApi.users.me, {});
  const isAuthed = !!me;

  const [mode, setMode] = useState("flat");
  const [layers, setLayers] = useState({ heat: false });
  const [filterIds, setFilterIds] = useState(null);
  const [scope, setScope] = useState(null);
  const [activeEvent, setActiveEvent] = useState(null);
  const [regionIso, setRegionIso] = useState(null);
  const [mapFocusIso, setMapFocusIso] = useState(null);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [density, setDensity] = useState("default");

  const displayed = useMemo(
    () => (filterIds ? events.filter((e) => filterIds.has(String(e._id))) : events),
    [events, filterIds],
  );

  // Choropleth coverage: full region rollup by default; the filtered set when a
  // search is active (so the tint focuses on matches).
  const filteredCoverage = useMemo(() => {
    const m = new Map();
    for (const e of displayed) {
      if (!e.isoA2) continue;
      const c = m.get(e.isoA2) ?? { count: 0, maxSev: -1, tier: "green" };
      c.count += 1;
      if (e.severity > c.maxSev) { c.maxSev = e.severity; c.tier = e.tier; }
      m.set(e.isoA2, c);
    }
    return [...m.entries()].map(([iso, v]) => ({ iso, count: v.count, maxSev: v.maxSev, tier: v.tier }));
  }, [displayed]);

  const onResult = (ids, sc, options = {}) => {
    if (ids == null) {
      setFilterIds(null);
      setScope(null);
      setMapFocusIso(null);
    } else {
      setFilterIds(new Set(ids.map(String)));
      setScope(sc);
      setMapFocusIso(options.focusIso ?? null);
    }
  };

  const pickRegion = (iso) => {
    setRegionIso(iso);
    setMapFocusIso(iso);
  };

  return (
    <>
      <MapStageBoundary>
        <MaprMap
          mode={mode}
          theme={theme}
          events={displayed}
          coverage={filterIds ? filteredCoverage : fullCoverage}
          layers={layers}
          activeEventId={activeEvent ? String(activeEvent._id) : null}
          onEventClick={(e) => setActiveEvent(e)}
          onRegionClick={pickRegion}
          focusIso={regionIso ?? mapFocusIso}
        />
      </MapStageBoundary>

      {filterIds && (
        <div className="map-result-banner">
          <span className="mrb-dot" />
          <span className="mrb-text">{displayed.length} of {events.length} events</span>
          {scope && <span className="mrb-scope">· {scope}</span>}
          <button className="mrb-clear" onClick={() => onResult(null, null)}>{CloseIco} RESET</button>
        </div>
      )}


      <WorkbenchRail
        selectedIso={regionIso ?? mapFocusIso}
        activeEvent={activeEvent}
        events={events}
        onPickRegion={pickRegion}
        onOpenEvent={(e) => setActiveEvent(e)}
        onNeedAuth={() => navigate("/account")}
      />

      <Composer
        mapMode={mode}
        heatEnabled={layers.heat}
        focusedRegion={regionIso ?? mapFocusIso}
        tweaksOpen={tweaksOpen}
        tweaksPanel={
          <div className="tweaks-panel" data-open="true" role="dialog" aria-label="Map filters">
            <div className="tweaks-row">
              <label>Heatmap</label>
              <div className="tweaks-opts">
                <button className="chip" data-active={layers.heat} onClick={() => setLayers((l) => ({ ...l, heat: !l.heat }))}>
                  {layers.heat ? "On" : "Off"}
                </button>
              </div>
            </div>
            <div className="tweaks-row">
              <label>Density</label>
              <div className="tweaks-opts">
                {DENSITIES.map((d) => (
                  <button key={d} className="chip" data-active={density === d} onClick={() => { setDensity(d); applyDensity(d); }}>{d}</button>
                ))}
              </div>
            </div>
          </div>
        }
        events={events}
        onMapModeChange={setMode}
        onTweaksToggle={() => setTweaksOpen((o) => !o)}
        onResult={onResult}
        onOpenEvent={(e) => setActiveEvent(e)}
        onPickRegion={pickRegion}
        isAuthed={isAuthed}
        onNeedAuth={() => navigate("/account")}
      />

      {activeEvent && <EventSheet event={activeEvent} onClose={() => setActiveEvent(null)} isAuthed={isAuthed} />}
    </>
  );
}
