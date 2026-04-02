import { buildBriefing } from './_lib/fetchBriefing.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }

  const iso = (req.query?.iso || '').toUpperCase();
  if (!iso) {
    return res.status(400).json({ error: 'Missing iso query parameter' });
  }

  try {
    const briefing = await buildBriefing({ writeState: false });
    const regionEvents = (briefing.events || []).filter((e) => e.isoA2 === iso);
    const snapshot = {
      timestamp: new Date().toISOString(),
      iso,
      eventCount: regionEvents.length,
      peakSeverity: regionEvents.length > 0
        ? Math.max(...regionEvents.map((e) => e.severity || 0))
        : 0
    };

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
      iso,
      snapshots: [snapshot],
      transitions: []
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
