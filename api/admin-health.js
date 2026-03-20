import { buildBriefing } from './_lib/fetchBriefing.js';
import { buildAdminHealthPayload } from '../src/utils/healthSummary.js';

export default async function handler(req, res) {
  const authHeader = (req.headers['x-admin-password'] || '').trim();
  const adminPassword = (process.env.ADMIN_PASSWORD || '').trim();

  if (!adminPassword || authHeader !== adminPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const briefing = await buildBriefing();
    return res.status(200).json(buildAdminHealthPayload(briefing, {
      timestamp: new Date().toISOString()
    }));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
