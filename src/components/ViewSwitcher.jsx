import React, { useEffect, useRef, useState } from 'react';

const VIEW_COLORS = ['#00d4ff', '#00e5a0', '#ffc93e', '#ff3b5c'];

const ViewSwitcher = ({ views = [], activeViewId, onSelect, onSave, onDelete }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const activeView = views.find((v) => v.id === activeViewId) || null;

  // Close on click outside
  useEffect(() => {
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = (view) => {
    onSelect(view);
    setOpen(false);
  };

  const handleSave = (e) => {
    e.stopPropagation();
    onSave();
  };

  const handleDelete = (e, view) => {
    e.stopPropagation();
    onDelete(view);
  };

  return (
    <div className="view-switcher" ref={containerRef}>
      <button
        className={`view-switcher-btn${open ? ' is-open' : ''}${activeView ? ' is-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Saved views"
      >
        {activeView ? activeView.name : 'VIEWS'}
        <span className="view-switcher-chevron" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="view-switcher-dropdown" role="listbox">
          {views.length === 0 ? (
            <div className="view-switcher-empty">No saved views</div>
          ) : (
            <ul className="view-switcher-list">
              {views.map((view, idx) => {
                const color = VIEW_COLORS[idx % VIEW_COLORS.length];
                return (
                  <li key={view.id} className="view-switcher-item">
                    <button
                      className={`view-switcher-row${view.id === activeViewId ? ' is-active' : ''}`}
                      onClick={() => handleSelect(view)}
                      role="option"
                      aria-selected={view.id === activeViewId}
                    >
                      <span
                        className="view-switcher-dot"
                        style={{ background: color }}
                        aria-hidden="true"
                      />
                      <span className="view-switcher-name">{view.name}</span>
                    </button>
                    <button
                      className="view-switcher-delete"
                      onClick={(e) => handleDelete(e, view)}
                      aria-label={`Delete view ${view.name}`}
                      title="Delete view"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="view-switcher-footer">
            <button
              className="view-switcher-save"
              onClick={handleSave}
              title="Save current state as new view"
            >
              <span aria-hidden="true">+</span>
              Save view
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ViewSwitcher;
