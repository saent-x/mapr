import React from 'react';

/**
 * Error boundary specific to map rendering. Three responsibilities:
 *
 *   1. When the Globe (WebGL) fails, call `onFallbackToFlat` so the app
 *      can switch to the FlatMap instead of crashing the entire UI.
 *   2. When the boundary has no parent fallback handler (e.g. the small
 *      inline maps on /event/:id), render a visible "Map unavailable"
 *      placeholder with a retry button — *not* a literal blank area,
 *      which is what users were seeing as "the map didn't show up".
 *   3. Auto-retry once after a short delay, since most WebGL failures
 *      on Chrome are transient (GPU process restart, tab-visibility
 *      thrash, momentary context loss). The `attempt` counter is
 *      threaded through children via the `key` prop so React fully
 *      remounts the subtree on retry — fresh canvas, fresh context.
 */
class MapErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, attempt: 0, autoRetryScheduled: false };
    this._autoRetryTimer = null;
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.warn('Map rendering failed:', error?.message);
    if (this.props.onFallbackToFlat) {
      this.props.onFallbackToFlat();
      return;
    }
    // No parent fallback — schedule a single auto-retry after 1.5s so a
    // transient WebGL hiccup recovers without the user having to click.
    if (!this.state.autoRetryScheduled) {
      this.setState({ autoRetryScheduled: true });
      this._autoRetryTimer = setTimeout(() => this.handleRetry(), 1500);
    }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.mapMode !== this.props.mapMode && this.state.hasError) {
      this.setState({ hasError: false, attempt: 0, autoRetryScheduled: false });
    }
  }

  componentWillUnmount() {
    if (this._autoRetryTimer) {
      clearTimeout(this._autoRetryTimer);
      this._autoRetryTimer = null;
    }
  }

  handleRetry = () => {
    if (this._autoRetryTimer) {
      clearTimeout(this._autoRetryTimer);
      this._autoRetryTimer = null;
    }
    this.setState((s) => ({
      hasError: false,
      attempt: s.attempt + 1,
      autoRetryScheduled: false,
    }));
  };

  render() {
    if (this.state.hasError) {
      // Parent (App.jsx) handles its own fallback by switching maps. For
      // inline callers we render a visible placeholder so the user knows
      // the area isn't broken — it's recovering.
      if (this.props.onFallbackToFlat) return null;
      return (
        <div
          role="alert"
          className="map-error-fallback"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
            height: '100%',
            minHeight: 160,
            padding: '16px 12px',
            color: 'var(--ink-2)',
            fontFamily: 'var(--ff-mono)',
            fontSize: 11,
            textAlign: 'center',
            background: 'var(--bg-2)',
            border: '1px dashed var(--line)',
            borderRadius: 3,
          }}
        >
          <span>Map couldn't render — likely a transient WebGL hiccup.</span>
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              padding: '4px 10px',
              background: 'transparent',
              border: '1px solid var(--line)',
              borderRadius: 2,
              color: 'var(--ink-0)',
              fontFamily: 'inherit',
              fontSize: 'inherit',
              cursor: 'pointer',
            }}
          >
            RETRY
          </button>
        </div>
      );
    }
    // Re-key children on each retry so React remounts the entire subtree
    // (fresh maplibre Map → fresh WebGL context). Without this the same
    // failing component is reused and the same error fires again.
    return (
      <React.Fragment key={this.state.attempt}>
        {this.props.children}
      </React.Fragment>
    );
  }
}

export default MapErrorBoundary;
