import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Progressive list rendering hook — renders items in batches as the user scrolls.
 * Avoids jank when displaying 500+ articles by only rendering a window of items.
 *
 * @param {Array} items - Full list of items
 * @param {Object} options
 * @param {number} options.initialCount - Number of items to render initially (default: 30)
 * @param {number} options.batchSize - Number of items to add per scroll batch (default: 20)
 * @param {string} options.resetKey - When this changes, the rendered count resets (e.g. region name)
 * @returns {{ visibleItems: Array, hasMore: boolean, sentinelRef: (el: HTMLElement) => void, renderedCount: number }}
 */
export default function useProgressiveList(items, {
  initialCount = 30,
  batchSize = 20,
  resetKey = '',
} = {}) {
  const [renderedCount, setRenderedCount] = useState(initialCount);
  const observerRef = useRef(null);
  const sentinelElRef = useRef(null);

  // Reset rendered count when items change significantly or resetKey changes
  useEffect(() => {
    setRenderedCount(initialCount);
  }, [resetKey, initialCount]);

  // IntersectionObserver to load more items when sentinel enters viewport
  const loadMore = useCallback(() => {
    setRenderedCount((prev) => Math.min(prev + batchSize, items.length));
  }, [batchSize, items.length]);

  const sentinelRef = useCallback((el) => {
    // Disconnect previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    sentinelElRef.current = el;

    if (!el) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: '200px' }
    );

    observerRef.current.observe(el);
  }, [loadMore]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  const visibleItems = items.slice(0, renderedCount);
  const hasMore = renderedCount < items.length;

  return { visibleItems, hasMore, sentinelRef, renderedCount };
}
