import { buildBriefing } from './_lib/fetchBriefing.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }

  try {
    // In serverless mode we don't have persistent storage for historical data.
    // Return a snapshot based on the current briefing as a single data point.
    const briefing = await buildBriefing();
    const snapshot = {
      timestamp: new Date().toISOString(),
      coveredCountries: briefing.coverageMetrics?.coveredCountries || 0,
      verifiedCountries: briefing.coverageMetrics?.verifiedCountries || 0,
      totalEvents: briefing.events?.length || 0
    };

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
      snapshots: [snapshot],
      transitions: [],
      trends: null
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
