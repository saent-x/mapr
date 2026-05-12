import { timingSafeEqualString } from './_lib/adminAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  if (!body) body = {};

  const adminPassword = String(process.env.ADMIN_PASSWORD || '').trim();
  if (!adminPassword) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD not configured' });
  }

  if (timingSafeEqualString(String(body.password || '').trim(), adminPassword)) {
    return res.status(200).json({ ok: true });
  }
  return res.status(401).json({ error: 'Invalid password' });
}
