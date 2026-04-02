const GDELT_DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');

  const { query } = req.query;
  let { timespan, maxrecords } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }

  // Validate and sanitize timespan
  if (!timespan || !/^\d+[mhd]$/.test(timespan)) {
    timespan = '15min';
  }

  // Validate and sanitize maxrecords
  maxrecords = parseInt(maxrecords, 10);
  if (isNaN(maxrecords) || maxrecords < 1) {
    maxrecords = 250;
  } else if (maxrecords > 500) {
    maxrecords = 500;
  }

  try {
    const params = new URLSearchParams({
      query,
      mode: 'artlist',
      format: 'json',
      timespan,
      maxrecords: String(maxrecords),
      sort: 'DateDesc',
    });

    const response = await fetch(`${GDELT_DOC_URL}?${params}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.status(502).json({ error: `GDELT returned ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
