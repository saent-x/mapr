import { buildBriefing } from './_lib/fetchBriefing.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    return res.status(204).end();
  }

  try {
    const briefing = await buildBriefing();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(briefing);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
