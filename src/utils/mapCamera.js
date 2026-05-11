function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function resolveIso(story) {
  const raw = story?.isoA2 || story?.primaryCountry || story?.countries?.[0] || '';
  const iso = String(raw || '').trim().toUpperCase();
  return iso || null;
}

export function getStoryCoordinateCenter(story) {
  const coordinates = story?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [lat, lng] = coordinates;
  if (!finiteNumber(lat) || !finiteNumber(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return [lng, lat];
}

export function getSelectedStoryCameraTarget(story, { stateMatch = null } = {}) {
  if (!story) return { type: 'none' };

  if (stateMatch && finiteNumber(stateMatch.lat) && finiteNumber(stateMatch.lng)) {
    return { type: 'point', center: [stateMatch.lng, stateMatch.lat] };
  }

  const center = getStoryCoordinateCenter(story);
  if (center) {
    return { type: 'point', center };
  }

  const iso = resolveIso(story);
  if (iso) {
    return { type: 'country', iso };
  }

  return { type: 'none' };
}

export function getRegionCameraTarget(selectedRegion, focalStory = null) {
  const center = getStoryCoordinateCenter(focalStory);
  if (center) {
    return { type: 'point', center };
  }

  const iso = String(selectedRegion || '').trim().toUpperCase();
  if (iso) {
    return { type: 'country', iso };
  }

  return { type: 'none' };
}
