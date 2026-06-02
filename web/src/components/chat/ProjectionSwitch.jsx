import { GlobeIco, MapIco, TuneIco } from "../icons.jsx";

export function ProjectionSwitch({ mapMode = "flat", tweaksOpen, filtersActive = tweaksOpen, tweaksPanel, onMapModeChange, onTweaksToggle }) {
  return (
    <div className="chat-projection-row">
      <div className="chat-projection" role="group" aria-label="Map mode">
        <button
          type="button"
          className="chat-projection__button chat-projection__button--icon"
          data-active={mapMode === "flat"}
          aria-pressed={mapMode === "flat"}
          aria-label="Flat map"
          title="Flat map"
          onClick={() => onMapModeChange?.("flat")}
        >
          {MapIco}
        </button>
        <button
          type="button"
          className="chat-projection__button chat-projection__button--icon"
          data-active={mapMode === "globe"}
          aria-pressed={mapMode === "globe"}
          aria-label="Globe"
          title="Globe"
          onClick={() => onMapModeChange?.("globe")}
        >
          {GlobeIco}
        </button>
      </div>
      <span className="chat-filter-anchor">
        <button
          type="button"
          className="chat-filter-button"
          data-active={filtersActive}
          aria-pressed={tweaksOpen}
          aria-label="Filters"
          title="Filters"
          onClick={onTweaksToggle}
        >
          {TuneIco}
        </button>
        {tweaksOpen && tweaksPanel}
      </span>
    </div>
  );
}
