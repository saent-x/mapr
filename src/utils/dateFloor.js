export const DATE_WINDOWS = [
  { id: '24h', label: '24h', i18nKey: '24h', hours: 24 },
  { id: '72h', label: '3 days', i18nKey: '3days', hours: 72 },
  { id: '168h', label: '7 days', i18nKey: '7days', hours: 168 },
  { id: '720h', label: '30 days', i18nKey: '30days', hours: 720 },
  { id: 'all', label: 'All', i18nKey: 'all', hours: null }
];

export const resolveDateFloor = (windowId, startDate) => {
  const candidates = [];
  const config = DATE_WINDOWS.find((opt) => opt.id === windowId);

  if (config?.hours) {
    candidates.push(new Date(Date.now() - config.hours * 60 * 60 * 1000));
  }

  if (startDate) {
    const d = new Date(`${startDate}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      candidates.push(d);
    }
  }

  if (!candidates.length) return null;

  return candidates.reduce((latest, c) => (c > latest ? c : latest));
};
