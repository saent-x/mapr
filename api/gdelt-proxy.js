const GDELT_DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');

  const { query, timespan = '24h', maxrecords = '200' } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }

  try {
    const params = new URLSearchParams({
      query,
      mode: 'artlist',
      format: 'json',
      timespan,
      maxrecords,
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
