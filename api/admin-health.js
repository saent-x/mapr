import { buildBriefing } from './_lib/fetchBriefing.js';
import { buildAdminHealthPayload } from '../src/utils/healthSummary.js';
import { isAdminAuthorized } from './_lib/adminAuth.js';

export default async function handler(req, res) {
  if (!isAdminAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const briefing = await buildBriefing();
    return res.status(200).json(buildAdminHealthPayload(briefing, {
      timestamp: new Date().toISOString()
    }));
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
