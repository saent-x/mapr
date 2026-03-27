import React from 'react';

/**
 * Error boundary specific to map rendering. When the Globe (WebGL) fails,
 * this calls `onFallbackToFlat` so the app can switch to the FlatMap instead
 * of crashing the entire UI.
 */
class MapErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.warn('Map rendering failed, falling back to flat map:', error?.message);
    if (this.props.onFallbackToFlat) {
      this.props.onFallbackToFlat();
    }
  }

  componentDidUpdate(prevProps) {
    // Reset error state when map mode changes (e.g., user switches to flat)
    if (prevProps.mapMode !== this.props.mapMode && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return null; // Let the parent re-render with flat map
    }
    return this.props.children;
  }
}

export default MapErrorBoundary;
