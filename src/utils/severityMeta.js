export const getSeverityMeta = (severity) => {
  if (severity >= 85) {
    return {
      label: 'Critical',
      labelKey: 'critical',
      accent: '#ff3b5c',
      muted: 'rgba(255, 59, 92, 0.15)',
      mapFill: 'rgba(255, 59, 92, 0.6)',
      mapSide: 'rgba(255, 59, 92, 0.28)',
      ring: 'rgba(255, 59, 92, 0.8)'
    };
  }

  if (severity >= 60) {
    return {
      label: 'Elevated',
      labelKey: 'elevated',
      accent: '#ff8a3d',
      muted: 'rgba(255, 138, 61, 0.15)',
      mapFill: 'rgba(255, 138, 61, 0.55)',
      mapSide: 'rgba(255, 138, 61, 0.25)',
      ring: 'rgba(255, 138, 61, 0.75)'
    };
  }

  if (severity >= 35) {
    return {
      label: 'Watch',
      labelKey: 'watch',
      accent: '#ffc93e',
      muted: 'rgba(255, 201, 62, 0.15)',
      mapFill: 'rgba(255, 201, 62, 0.5)',
      mapSide: 'rgba(255, 201, 62, 0.22)',
      ring: 'rgba(255, 201, 62, 0.7)'
    };
  }

  return {
    label: 'Low',
    labelKey: 'low',
    accent: '#3ee8b0',
    muted: 'rgba(62, 232, 176, 0.12)',
    mapFill: 'rgba(62, 232, 176, 0.45)',
    mapSide: 'rgba(62, 232, 176, 0.2)',
    ring: 'rgba(62, 232, 176, 0.65)'
  };
};
