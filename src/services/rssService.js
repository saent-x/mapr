import { geocodeArticle, countryToIso } from '../utils/geocoder';
import { deriveSeverity, deriveCategory } from '../utils/articleUtils';

const CORS_PROXIES = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
];

// ── Regional RSS Feeds (English-language editions) ──────────────────────────

const RSS_FEEDS = [
  // ─── Africa ───
  { name: 'Punch Nigeria', url: 'https://punchng.com/feed/', id: 'punch-ng', country: 'Nigeria' },
  { name: 'Vanguard Nigeria', url: 'https://www.vanguardngr.com/feed/', id: 'vanguard-ng', country: 'Nigeria' },
  { name: 'Premium Times Nigeria', url: 'https://www.premiumtimesng.com/feed', id: 'premiumtimes-ng', country: 'Nigeria' },
  { name: 'News24 South Africa', url: 'https://feeds.news24.com/articles/news24/TopStories/rss', id: 'news24-za', country: 'South Africa' },
  { name: 'Daily Nation Kenya', url: 'https://nation.africa/kenya/rss.xml', id: 'nation-ke', country: 'Kenya' },
  { name: 'GhanaWeb', url: 'https://www.ghanaweb.com/GhanaHomePage/NewsArchive/rss.xml', id: 'ghanaweb', country: 'Ghana' },
  { name: 'Ahram Online Egypt', url: 'https://english.ahram.org.eg/UI/Front/Ede.aspx?t=rss', id: 'ahram-eg', country: 'Egypt' },
  { name: 'The Citizen Tanzania', url: 'https://www.thecitizen.co.tz/tanzania/rss.xml', id: 'citizen-tz', country: 'Tanzania' },
  { name: 'Daily Monitor Uganda', url: 'https://www.monitor.co.ug/uganda/rss.xml', id: 'monitor-ug', country: 'Uganda' },

  // ─── Asia ───
  { name: 'NDTV India', url: 'https://feeds.feedburner.com/ndtvnews-top-stories', id: 'ndtv', country: 'India' },
  { name: 'Times of India', url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms', id: 'toi', country: 'India' },
  { name: 'Hindustan Times', url: 'https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml', id: 'ht-in', country: 'India' },
  { name: 'Japan Times', url: 'https://www.japantimes.co.jp/feed/', id: 'japantimes', country: 'Japan' },
  { name: 'Korea Herald', url: 'http://www.koreaherald.com/common/rss_xml.php?ct=102', id: 'koreaherald', country: 'South Korea' },
  { name: 'Rappler Philippines', url: 'https://www.rappler.com/feed/', id: 'rappler-ph', country: 'Philippines' },
  { name: 'Dawn Pakistan', url: 'https://www.dawn.com/feed', id: 'dawn-pk', country: 'Pakistan' },
  { name: 'Daily Star Bangladesh', url: 'https://www.thedailystar.net/frontpage/rss.xml', id: 'dailystar-bd', country: 'Bangladesh' },
  { name: 'Straits Times Singapore', url: 'https://www.straitstimes.com/news/asia/rss.xml', id: 'straitstimes-sg', country: 'Singapore' },
  { name: 'Bangkok Post', url: 'https://www.bangkokpost.com/rss/data/topstories.xml', id: 'bangkokpost-th', country: 'Thailand' },
  { name: 'South China Morning Post', url: 'https://www.scmp.com/rss/91/feed', id: 'scmp', country: 'China' },
  { name: 'Taipei Times', url: 'https://www.taipeitimes.com/xml/index.rss', id: 'taipeitimes-tw', country: 'Taiwan' },

  // ─── Middle East ───
  { name: 'Daily Sabah Turkey', url: 'https://www.dailysabah.com/rssFeed/home', id: 'dailysabah-tr', country: 'Turkey' },
  { name: 'Arab News Saudi', url: 'https://www.arabnews.com/rss.xml', id: 'arabnews-sa', country: 'Saudi Arabia' },
  { name: 'Gulf News UAE', url: 'https://gulfnews.com/rss', id: 'gulfnews-ae', country: 'United Arab Emirates' },
  { name: 'Khaleej Times UAE', url: 'https://www.khaleejtimes.com/rss', id: 'khaleejtimes-ae', country: 'United Arab Emirates' },
  { name: 'Jordan Times', url: 'https://www.jordantimes.com/rss.xml', id: 'jordantimes-jo', country: 'Jordan' },
  { name: 'Daily Star Lebanon', url: 'https://www.dailystar.com.lb/RSS.aspx', id: 'dailystar-lb', country: 'Lebanon' },
  { name: 'Al-Monitor Middle East', url: 'https://www.al-monitor.com/rss', id: 'almonitor', country: null },

  // ─── Europe ───
  { name: 'Guardian World', url: 'https://www.theguardian.com/world/rss', id: 'guardian-uk', country: null },
  { name: 'Telegraph', url: 'https://www.telegraph.co.uk/rss.xml', id: 'telegraph-uk', country: 'United Kingdom' },
  { name: 'France 24', url: 'https://www.france24.com/en/rss', id: 'france24', country: null },
  { name: 'DW News', url: 'https://rss.dw.com/rdf/rss-en-world', id: 'dw', country: null },
  { name: 'Irish Times', url: 'https://www.irishtimes.com/cmlink/news-1.1319192', id: 'irishtimes-ie', country: 'Ireland' },
  { name: 'Euronews', url: 'https://www.euronews.com/rss', id: 'euronews', country: null },
  { name: 'The Local Europe', url: 'https://www.thelocal.com/feeds/rss.php', id: 'thelocal-eu', country: null },
  { name: 'ANSA Italy', url: 'https://www.ansa.it/english/news/rss.xml', id: 'ansa-it', country: 'Italy' },
  { name: 'Moscow Times', url: 'https://www.themoscowtimes.com/rss/news', id: 'moscowtimes-ru', country: 'Russia' },
  { name: 'Kyiv Independent', url: 'https://kyivindependent.com/feed/', id: 'kyivindependent-ua', country: 'Ukraine' },

  // ─── Americas ───
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', id: 'bbc', country: null },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', id: 'aljazeera', country: null },
  { name: 'ABC News', url: 'https://abcnews.go.com/abcnews/internationalheadlines', id: 'abc', country: null },
  { name: 'NPR World', url: 'https://feeds.npr.org/1004/rss.xml', id: 'npr', country: null },
  { name: 'Reuters World', url: 'https://www.reutersagency.com/feed/', id: 'reuters', country: null },
  { name: 'AP News', url: 'https://rsshub.app/apnews/topics/apf-topnews', id: 'apnews', country: null },
  { name: 'Mexico News Daily', url: 'https://mexiconewsdaily.com/feed/', id: 'mxnewsdaily', country: 'Mexico' },
  { name: 'Rio Times Brazil', url: 'https://www.riotimesonline.com/feed/', id: 'riotimes-br', country: 'Brazil' },
  { name: 'Buenos Aires Times', url: 'https://www.batimes.com.ar/feed', id: 'batimes-ar', country: 'Argentina' },
  { name: 'Colombia Reports', url: 'https://colombiareports.com/feed/', id: 'colreports-co', country: 'Colombia' },

  // ─── Oceania ───
  { name: 'ABC Australia', url: 'https://www.abc.net.au/news/feed/2942460/rss.xml', id: 'abc-au', country: 'Australia' },
  { name: 'NZ Herald', url: 'https://www.nzherald.co.nz/arc/outboundfeeds/rss/curated/78/?outputType=xml', id: 'nzherald-nz', country: 'New Zealand' },
  { name: 'RNZ New Zealand', url: 'https://www.rnz.co.nz/rss/national.xml', id: 'rnz-nz', country: 'New Zealand' },
  { name: 'Sydney Morning Herald', url: 'https://www.smh.com.au/rss/feed.xml', id: 'smh-au', country: 'Australia' },
];

// Cache + fetch lock (prevents StrictMode double-fetch)
let cachedArticles = null;
let cacheTimestamp = 0;
let fetchInProgress = null;
const CACHE_TTL = 5 * 60 * 1000;

function getTextContent(item, tagName) {
  const el = item.querySelector(tagName);
  return el ? el.textContent.trim() : '';
}

function stripHtml(str) {
  if (!str) return '';
  try {
    return new DOMParser().parseFromString(str, 'text/html').body.textContent.trim();
  } catch {
    return str.replace(/<[^>]*>/g, '').trim();
  }
}

function getMediaUrl(item) {
  const media = item.querySelector('content, thumbnail');
  if (media?.getAttribute('url')) return media.getAttribute('url');

  const enclosure = item.querySelector('enclosure');
  if (enclosure?.getAttribute('url') && enclosure.getAttribute('type')?.startsWith('image')) {
    return enclosure.getAttribute('url');
  }

  return null;
}

/**
 * Simple English language detection heuristic.
 * Returns true if text appears to be in English.
 */
function looksEnglish(text) {
  if (!text || text.length < 20) return true;
  const markers = ['the ', ' is ', ' in ', ' of ', ' and ', ' to ', ' for ', ' a ', ' on ', ' at ', ' has ', ' was ', ' are ', ' with '];
  const lower = text.toLowerCase();
  const hits = markers.filter((m) => lower.includes(m)).length;
  return hits >= 3;
}

function normalizeRssArticle(item, feedConfig, index) {
  const title = getTextContent(item, 'title');
  if (!title) return null;

  const description = stripHtml(getTextContent(item, 'description'));

  // Filter non-English articles
  if (!looksEnglish(title + ' ' + (description || ''))) return null;

  const link = getTextContent(item, 'link');
  const pubDate = getTextContent(item, 'pubDate');

  const geo = geocodeArticle(title, feedConfig.country);
  if (!geo) return null;

  const severity = deriveSeverity(title);
  const category = deriveCategory(title);
  const iso = countryToIso(geo.region);

  let publishedAt;
  try {
    const d = new Date(pubDate);
    publishedAt = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } catch {
    publishedAt = new Date().toISOString();
  }

  return {
    id: `rss-${feedConfig.id}-${index}`,
    title,
    summary: description || title,
    url: link,
    severity,
    publishedAt,
    region: geo.region,
    isoA2: iso || 'XX',
    locality: geo.locality,
    category,
    coordinates: [geo.lat, geo.lng],
    source: feedConfig.name,
    socialimage: getMediaUrl(item),
    isLive: true
  };
}

async function fetchFeed(feed) {
  for (const proxy of CORS_PROXIES) {
    try {
      const url = `${proxy}${encodeURIComponent(feed.url)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) continue;

      const xmlText = await response.text();
      const doc = new DOMParser().parseFromString(xmlText, 'text/xml');

      if (doc.querySelector('parsererror')) continue;

      let items = doc.querySelectorAll('item');
      if (items.length === 0) items = doc.querySelectorAll('entry');

      const articles = [];
      items.forEach((item, i) => {
        const article = normalizeRssArticle(item, feed, i);
        if (article) articles.push(article);
      });

      return articles;
    } catch {
      continue;
    }
  }
  return [];
}

/**
 * Fetch feeds in batches to avoid overwhelming CORS proxies.
 */
async function fetchFeedsBatched(feeds, batchSize = 4, delayMs = 1200) {
  const allArticles = [];

  for (let i = 0; i < feeds.length; i += batchSize) {
    const batch = feeds.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(fetchFeed));

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allArticles.push(...result.value);
      }
    }

    // Delay between batches (skip after last batch)
    if (i + batchSize < feeds.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return allArticles;
}

/**
 * Fetch news from all RSS feeds with batched requests.
 * Uses a fetch lock to prevent concurrent fetches (e.g. React StrictMode).
 */
export async function fetchRssNews() {
  const now = Date.now();

  if (cachedArticles && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedArticles;
  }

  // Return existing fetch if one is already in progress
  if (fetchInProgress) return fetchInProgress;

  fetchInProgress = (async () => {
    try {
      const articles = await fetchFeedsBatched(RSS_FEEDS);
      articles.sort((a, b) => b.severity - a.severity);
      cachedArticles = articles;
      cacheTimestamp = Date.now();
      return articles;
    } finally {
      fetchInProgress = null;
    }
  })();

  return fetchInProgress;
}

export function clearRssCache() {
  cachedArticles = null;
  cacheTimestamp = 0;
}
