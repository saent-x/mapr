import { Component } from "react";

export default class MapStageBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("Map stage failed", error);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="map-stage map-stage-fallback" role="status" aria-live="polite">
          <div className="map-stage-fallback__copy">
            <span className="micro">Map unavailable</span>
            <p>WebGL is unavailable in this browser context. Chat and event workflows remain available.</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
