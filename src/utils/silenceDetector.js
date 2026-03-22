const RESTRICTED_COUNTRIES = ['KP', 'TM', 'ER'];

export function detectSilence({ iso, currentCount, rollingAverage, gdeltActive = false }) {
  if (currentCount === 0 && gdeltActive) {
    return { status: 'blind-spot' };
  }

  if (RESTRICTED_COUNTRIES.includes(iso) && currentCount === 0) {
    return { status: 'limited-access' };
  }

  if (rollingAverage > 0 && currentCount < rollingAverage * 0.3) {
    return { status: 'anomalous-silence' };
  }

  if (rollingAverage > 0 && currentCount < rollingAverage * 0.6) {
    return { status: 'sparse' };
  }

  return { status: 'covered' };
}

export function computeSilenceMap(regions) {
  const map = {};
  for (const region of regions) {
    map[region.iso] = detectSilence(region);
  }
  return map;
}
