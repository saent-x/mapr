import { useState, useEffect } from 'react';
import useNewsStore from '../stores/newsStore';
import { formatAge, getFreshnessColor, GREEN_THRESHOLD, AMBER_THRESHOLD } from '../utils/dataFreshness';

export { formatAge, getFreshnessColor, GREEN_THRESHOLD, AMBER_THRESHOLD };

/**
 * Hook that tracks data freshness: age since last successful data load.
 * Returns { ageValue, ageUnit, ageColor, ageMs, lastLoadTime }.
 * Updates every second for real-time display.
 */
export default function useDataFreshness() {
  const lastDataLoadTime = useNewsStore((s) => s.lastDataLoadTime);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!lastDataLoadTime) {
    return { ageValue: null, ageUnit: null, ageColor: 'red', ageMs: null, lastLoadTime: null };
  }

  const ageMs = now - lastDataLoadTime;
  const { value, unit } = formatAge(ageMs);
  const color = getFreshnessColor(ageMs);

  return { ageValue: value, ageUnit: unit, ageColor: color, ageMs, lastLoadTime: lastDataLoadTime };
}
