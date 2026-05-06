import { useEffect, useRef, useCallback } from 'react';

/**
 * Checks whether the currently focused element is a text-editing field
 * where keyboard shortcuts should be suppressed.
 */
function isEditingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  // Also check for contenteditable="true" on parent
  if (el.getAttribute('contenteditable') === 'true') return true;
  return false;
}

/**
 * useKeyboardNavigation — centralized keyboard shortcut hook.
 *
 * @param {Object} options
 * @param {Array}   options.items              — list of navigable items
 * @param {Function} options.onSelect          — called with item and index on Enter
 * @param {Function} options.onBookmark        — called with selected item on b
 * @param {Function} options.onSaveView        — called on s
 * @param {Function} options.onEscape          — called on Escape (for composable escape chains)
 * @param {Function} [options.onHelp]          — called on ? key
 * @param {boolean}  [options.disabled=false]  — disable all keyboard shortcuts
 * @param {string}   [options.searchSelector]  — CSS selector for search input to focus on /
 *
 * @returns {Object} { selectedIndex, selectedItem, setSelectedIndex }
 */
export default function useKeyboardNavigation({
  items = [],
  onSelect,
  onBookmark,
  onSaveView,
  onEscape,
  onHelp,
  disabled = false,
  searchSelector = '.search-input, .header-search input',
} = {}) {
  const selectedIndexRef = useRef(-1);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const callbacksRef = useRef({ onSelect, onBookmark, onSaveView, onEscape, onHelp });
  callbacksRef.current = { onSelect, onBookmark, onSaveView, onEscape, onHelp };

  const getSelectedIndex = useCallback(() => selectedIndexRef.current, []);
  const setSelectedIndex = useCallback((idx) => {
    selectedIndexRef.current = idx;
  }, []);

  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (e) => {
      const target = e.target;
      const editing = isEditingTarget(target);

      // Suppress all non-Escape shortcuts when typing
      if (editing && e.key !== 'Escape') return;

      const items = itemsRef.current;
      const cb = callbacksRef.current;

      switch (e.key) {
        case 'j':
        case 'J': {
          if (items.length === 0) return;
          e.preventDefault();
          let next = selectedIndexRef.current + 1;
          if (next >= items.length) next = 0; // wrap to top
          selectedIndexRef.current = next;
          // Scroll highlighted element into view
          requestAnimationFrame(() => {
            const el = document.querySelector('[data-kb-highlighted="true"]');
            if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          });
          break;
        }

        case 'k':
        case 'K': {
          if (items.length === 0) return;
          e.preventDefault();
          let next = selectedIndexRef.current - 1;
          if (next < 0) next = items.length - 1; // wrap to bottom
          selectedIndexRef.current = next;
          requestAnimationFrame(() => {
            const el = document.querySelector('[data-kb-highlighted="true"]');
            if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          });
          break;
        }

        case 'Enter': {
          const idx = selectedIndexRef.current;
          if (idx >= 0 && idx < items.length && cb.onSelect) {
            e.preventDefault();
            cb.onSelect(items[idx], idx);
          }
          break;
        }

        case 'Escape': {
          if (cb.onEscape) {
            const handled = cb.onEscape();
            // If onEscape returns false, the event wasn't fully consumed
            // and we let it propagate (e.g., to close parent modals)
            if (handled !== false) {
              selectedIndexRef.current = -1;
            }
          }
          break;
        }

        case '/': {
          // Don't intercept if already in an input
          if (editing) return;
          e.preventDefault();
          const searchEl = searchSelector ? document.querySelector(searchSelector) : null;
          if (searchEl) {
            searchEl.focus();
            // Select any existing text so user can type immediately
            if (typeof searchEl.select === 'function') searchEl.select();
          }
          break;
        }

        case 's':
        case 'S': {
          if (cb.onSaveView) {
            e.preventDefault();
            cb.onSaveView();
          }
          break;
        }

        case 'b':
        case 'B': {
          const idx = selectedIndexRef.current;
          if (idx >= 0 && idx < items.length && cb.onBookmark) {
            e.preventDefault();
            cb.onBookmark(items[idx], idx);
          }
          break;
        }

        case '?': {
          if (cb.onHelp) {
            e.preventDefault();
            cb.onHelp();
          }
          break;
        }

        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [disabled, searchSelector]);

  return { getSelectedIndex, setSelectedIndex };
}
