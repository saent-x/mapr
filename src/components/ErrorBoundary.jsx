import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info?.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary" role="alert">
          <div className="error-boundary-inner">
            <div className="micro" style={{ color: 'var(--sev-red)', marginBottom: 8 }}>FAULT</div>
            <h2 style={{ fontFamily: 'var(--ff-serif)', fontWeight: 400, margin: '0 0 10px', color: 'var(--ink-0)' }}>
              Something went wrong
            </h2>
            <p style={{ color: 'var(--ink-1)', fontSize: 'var(--fs-2)' }}>
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button type="button" className="error-boundary-retry" onClick={this.handleRetry}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
