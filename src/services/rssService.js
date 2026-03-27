import { geocodeArticle, countryToIso } from '../utils/geocoder.js';
import { deriveSeverity, deriveCategory } from '../utils/articleUtils.js';
import { classifySourceType } from '../utils/sourceMetadata.js';
import { detectLanguage } from '../utils/languageUtils.js';

export const CORS_PROXIES = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
];

export const OFFICIAL_FEEDS = [
  {
    name: 'USGS Significant Earthquakes',
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.atom',
    id: 'usgs-significant',
    country: null,
    sourceType: 'official',
    language: 'en'
  },
  {
    name: 'UN News',
    url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml',
    id: 'un-news',
    country: null,
    sourceType: 'official',
    language: 'en'
  },
  {
    name: 'WHO Disease Outbreak News',
    url: 'https://www.who.int/feeds/entity/csr/don/en/rss.xml',
    id: 'who-don',
    country: null,
    sourceType: 'official',
    language: 'en'
  }
];

const AFRICA_COVERAGE_COUNTRIES = [
  'Algeria', 'Angola', 'Botswana', 'Burkina Faso', 'Cameroon', 'Chad',
  'Dem. Rep. Congo', 'Egypt', 'Ethiopia', 'Ghana', 'Guinea', 'Ivory Coast',
  'Kenya', 'Libya', 'Madagascar', 'Mali', 'Morocco', 'Mozambique', 'Namibia',
  'Niger', 'Nigeria', 'Rwanda', 'Senegal', 'Somalia', 'South Africa',
  'South Sudan', 'Sudan', 'Tanzania', 'Tunisia', 'Uganda', 'Zambia', 'Zimbabwe'
];

const MENA_COVERAGE_COUNTRIES = [
  'Bahrain', 'Egypt', 'Iran', 'Iraq', 'Israel', 'Jordan', 'Kuwait',
  'Lebanon', 'Oman', 'Palestine', 'Qatar', 'Saudi Arabia', 'Syria',
  'Turkey', 'United Arab Emirates', 'Yemen'
];

const ASIA_COVERAGE_COUNTRIES = [
  'Afghanistan', 'Bangladesh', 'Cambodia', 'China', 'India', 'Indonesia',
  'Japan', 'Kazakhstan', 'Laos', 'Malaysia', 'Mongolia', 'Myanmar',
  'Nepal', 'North Korea', 'Pakistan', 'Philippines', 'Singapore',
  'South Korea', 'Sri Lanka', 'Taiwan', 'Thailand', 'Uzbekistan', 'Vietnam'
];


const EUROPE_COVERAGE_COUNTRIES = [
  'Austria', 'Belgium', 'Czech Republic', 'Denmark', 'Finland', 'France',
  'Germany', 'Greece', 'Hungary', 'Ireland', 'Italy', 'Netherlands',
  'Norway', 'Poland', 'Portugal', 'Romania', 'Spain', 'Sweden',
  'Switzerland', 'United Kingdom'
];

const CAUCASUS_COVERAGE_COUNTRIES = ['Armenia', 'Azerbaijan', 'Georgia'];
const BALKANS_COVERAGE_COUNTRIES = ['Albania', 'Bosnia', 'Bulgaria', 'Croatia', 'Montenegro', 'Romania', 'Serbia', 'Slovenia'];
const PACIFIC_COVERAGE_COUNTRIES = ['Australia', 'Fiji', 'New Zealand', 'Papua New Guinea'];

const DISABLED_FEED_IDS = new Set([
  // Dead or obsolete endpoints that consistently return 404/403 and distort source health.
  'who-don',
  'reuters',
  'apnews',
  'aa-cd',
  'aa-bf',
  'aa-ss',
  'ghanaweb',
  'citizen-tz',
  'gulfnews-ae',
  'khaleejtimes-ae',
  'jakartapost-id',
  'ansa-it',
  'merco-pe',
  'merco-bo',
  'merco-ec'
]);

// ── Regional and global publisher feeds ──────────────────────────

export const RSS_FEEDS = [
  // ═══════════════════════════════════════════
  // ─── GLOBAL / WIRE ─────────────────────────
  // ═══════════════════════════════════════════
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', id: 'bbc', country: null, sourceType: 'wire' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', id: 'aljazeera', country: null, sourceType: 'wire' },
  { name: 'France 24', url: 'https://www.france24.com/en/rss', id: 'france24', country: null, sourceType: 'wire' },
  { name: 'DW News', url: 'https://rss.dw.com/rdf/rss-en-world', id: 'dw', country: null, sourceType: 'wire' },
  { name: 'ABC News', url: 'https://abcnews.go.com/abcnews/internationalheadlines', id: 'abc', country: null, sourceType: 'wire' },
  { name: 'NPR World', url: 'https://feeds.npr.org/1004/rss.xml', id: 'npr', country: null, sourceType: 'wire' },
  { name: 'Reuters World', url: 'https://www.reutersagency.com/feed/', id: 'reuters', country: null, sourceType: 'wire' },
  { name: 'AP News', url: 'https://rsshub.app/apnews/topics/apf-topnews', id: 'apnews', country: null, sourceType: 'wire' },
  { name: 'Guardian World', url: 'https://www.theguardian.com/world/rss', id: 'guardian-uk', country: null, sourceType: 'global' },
  { name: 'Euronews', url: 'https://www.euronews.com/rss', id: 'euronews', country: null, sourceType: 'global' },

  // ═══════════════════════════════════════════
  // ─── AFRICA ────────────────────────────────
  // ═══════════════════════════════════════════
  { name: 'Africanews', url: 'https://www.africanews.com/feed/rss', id: 'africanews', country: null, sourceType: 'regional', coverageCountries: AFRICA_COVERAGE_COUNTRIES },
  { name: 'AllAfrica', url: 'https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf', id: 'allafrica', country: null, sourceType: 'regional', coverageCountries: AFRICA_COVERAGE_COUNTRIES },
  // Per-country (AllAfrica)
  { name: 'AllAfrica Morocco', url: 'https://allafrica.com/tools/headlines/rdf/morocco/headlines.rdf', id: 'aa-ma', country: 'Morocco' },
  { name: 'AllAfrica Tunisia', url: 'https://allafrica.com/tools/headlines/rdf/tunisia/headlines.rdf', id: 'aa-tn', country: 'Tunisia' },
  { name: 'AllAfrica Libya', url: 'https://allafrica.com/tools/headlines/rdf/libya/headlines.rdf', id: 'aa-ly', country: 'Libya' },
  { name: 'AllAfrica Senegal', url: 'https://allafrica.com/tools/headlines/rdf/senegal/headlines.rdf', id: 'aa-sn', country: 'Senegal' },
  { name: 'AllAfrica Cameroon', url: 'https://allafrica.com/tools/headlines/rdf/cameroon/headlines.rdf', id: 'aa-cm', country: 'Cameroon' },
  { name: 'AllAfrica Ivory Coast', url: 'https://allafrica.com/tools/headlines/rdf/cotedivoire/headlines.rdf', id: 'aa-ci', country: 'Ivory Coast' },
  { name: 'AllAfrica Mali', url: 'https://allafrica.com/tools/headlines/rdf/mali/headlines.rdf', id: 'aa-ml', country: 'Mali' },
  { name: 'AllAfrica Mozambique', url: 'https://allafrica.com/tools/headlines/rdf/mozambique/headlines.rdf', id: 'aa-mz', country: 'Mozambique' },
  { name: 'AllAfrica Zimbabwe', url: 'https://allafrica.com/tools/headlines/rdf/zimbabwe/headlines.rdf', id: 'aa-zw', country: 'Zimbabwe' },
  { name: 'AllAfrica Zambia', url: 'https://allafrica.com/tools/headlines/rdf/zambia/headlines.rdf', id: 'aa-zm', country: 'Zambia' },
  { name: 'AllAfrica Rwanda', url: 'https://allafrica.com/tools/headlines/rdf/rwanda/headlines.rdf', id: 'aa-rw', country: 'Rwanda' },
  { name: 'AllAfrica Somalia', url: 'https://allafrica.com/tools/headlines/rdf/somalia/headlines.rdf', id: 'aa-so', country: 'Somalia' },
  { name: 'AllAfrica DR Congo', url: 'https://allafrica.com/tools/headlines/rdf/congo-kinshasa/headlines.rdf', id: 'aa-cd', country: 'Dem. Rep. Congo' },
  { name: 'AllAfrica Angola', url: 'https://allafrica.com/tools/headlines/rdf/angola/headlines.rdf', id: 'aa-ao', country: 'Angola' },
  { name: 'AllAfrica Madagascar', url: 'https://allafrica.com/tools/headlines/rdf/madagascar/headlines.rdf', id: 'aa-mg', country: 'Madagascar' },
  { name: 'AllAfrica Botswana', url: 'https://allafrica.com/tools/headlines/rdf/botswana/headlines.rdf', id: 'aa-bw', country: 'Botswana' },
  { name: 'AllAfrica Namibia', url: 'https://allafrica.com/tools/headlines/rdf/namibia/headlines.rdf', id: 'aa-na', country: 'Namibia' },
  { name: 'AllAfrica Algeria', url: 'https://allafrica.com/tools/headlines/rdf/algeria/headlines.rdf', id: 'aa-dz', country: 'Algeria' },
  { name: 'AllAfrica Chad', url: 'https://allafrica.com/tools/headlines/rdf/chad/headlines.rdf', id: 'aa-td', country: 'Chad' },
  { name: 'AllAfrica Guinea', url: 'https://allafrica.com/tools/headlines/rdf/guinea/headlines.rdf', id: 'aa-gn', country: 'Guinea' },
  { name: 'AllAfrica Burkina Faso', url: 'https://allafrica.com/tools/headlines/rdf/burkina-faso/headlines.rdf', id: 'aa-bf', country: 'Burkina Faso' },
  { name: 'AllAfrica Niger', url: 'https://allafrica.com/tools/headlines/rdf/niger/headlines.rdf', id: 'aa-ne', country: 'Niger' },
  { name: 'AllAfrica South Sudan', url: 'https://allafrica.com/tools/headlines/rdf/south-sudan/headlines.rdf', id: 'aa-ss', country: 'South Sudan' },
  { name: 'AllAfrica Benin', url: 'https://allafrica.com/tools/headlines/rdf/benin/headlines.rdf', id: 'aa-bj', country: 'Benin' },
  { name: 'AllAfrica Uganda', url: 'https://allafrica.com/tools/headlines/rdf/uganda/headlines.rdf', id: 'aa-ug', country: 'Uganda' },
  { name: 'AllAfrica Tanzania', url: 'https://allafrica.com/tools/headlines/rdf/tanzania/headlines.rdf', id: 'aa-tz', country: 'Tanzania' },
  // Dedicated African outlets
  { name: 'Morocco World News', url: 'https://www.moroccoworldnews.com/feed/', id: 'mwn-ma', country: 'Morocco' },
  { name: 'Punch Nigeria', url: 'https://punchng.com/feed/', id: 'punch-ng', country: 'Nigeria' },
  { name: 'Vanguard Nigeria', url: 'https://www.vanguardngr.com/feed/', id: 'vanguard-ng', country: 'Nigeria' },
  { name: 'Premium Times Nigeria', url: 'https://www.premiumtimesng.com/feed', id: 'premiumtimes-ng', country: 'Nigeria' },
  { name: 'News24 South Africa', url: 'https://feeds.news24.com/articles/news24/TopStories/rss', id: 'news24-za', country: 'South Africa' },
  { name: 'Daily Nation Kenya', url: 'https://nation.africa/kenya/rss.xml', id: 'nation-ke', country: 'Kenya' },
  { name: 'GhanaWeb', url: 'https://www.ghanaweb.com/GhanaHomePage/NewsArchive/rss.xml', id: 'ghanaweb', country: 'Ghana' },
  { name: 'Ahram Online Egypt', url: 'https://english.ahram.org.eg/UI/Front/Ede.aspx?t=rss', id: 'ahram-eg', country: 'Egypt' },
  { name: 'Sudan Tribune', url: 'https://sudantribune.com/feed/', id: 'sudantribune-sd', country: 'Sudan' },
  { name: 'Addis Standard', url: 'https://addisstandard.com/feed/', id: 'addisstandard-et', country: 'Ethiopia' },
  { name: 'The Citizen Tanzania', url: 'https://www.thecitizen.co.tz/tanzania/rss.xml', id: 'citizen-tz', country: 'Tanzania' },
  { name: 'Daily Monitor Uganda', url: 'https://www.monitor.co.ug/uganda/rss.xml', id: 'monitor-ug', country: 'Uganda' },
  // East Africa — underrepresented countries
  { name: 'AllAfrica Eritrea', url: 'https://allafrica.com/tools/headlines/rdf/eritrea/headlines.rdf', id: 'aa-er', country: 'Eritrea' },
  { name: 'AllAfrica Djibouti', url: 'https://allafrica.com/tools/headlines/rdf/djibouti/headlines.rdf', id: 'aa-dj', country: 'Djibouti' },
  { name: 'AllAfrica Comoros', url: 'https://allafrica.com/tools/headlines/rdf/comoros/headlines.rdf', id: 'aa-km', country: 'Comoros' },
  { name: 'AllAfrica Mauritius', url: 'https://allafrica.com/tools/headlines/rdf/mauritius/headlines.rdf', id: 'aa-mu', country: 'Mauritius' },
  { name: 'AllAfrica Seychelles', url: 'https://allafrica.com/tools/headlines/rdf/seychelles/headlines.rdf', id: 'aa-sc', country: 'Seychelles' },
  { name: 'Seychelles News Agency', url: 'http://www.seychellesnewsagency.com/rss', id: 'sna-sc', country: 'Seychelles' },
  { name: 'Defimedia Mauritius', url: 'http://www.defimedia.info/?format=feed&type=rss', id: 'defimedia-mu', country: 'Mauritius' },
  // West Africa — underrepresented countries
  { name: 'AllAfrica Togo', url: 'https://allafrica.com/tools/headlines/rdf/togo/headlines.rdf', id: 'aa-tg', country: 'Togo' },
  { name: 'AllAfrica Sierra Leone', url: 'https://allafrica.com/tools/headlines/rdf/sierraleone/headlines.rdf', id: 'aa-sl', country: 'Sierra Leone' },
  { name: 'AllAfrica Liberia', url: 'https://allafrica.com/tools/headlines/rdf/liberia/headlines.rdf', id: 'aa-lr', country: 'Liberia' },
  { name: 'AllAfrica Guinea-Bissau', url: 'https://allafrica.com/tools/headlines/rdf/guinea-bissau/headlines.rdf', id: 'aa-gw', country: 'Guinea-Bissau' },
  { name: 'AllAfrica Gambia', url: 'https://allafrica.com/tools/headlines/rdf/gambia/headlines.rdf', id: 'aa-gm', country: 'Gambia' },
  { name: 'AllAfrica Cabo Verde', url: 'https://allafrica.com/tools/headlines/rdf/capeverde/headlines.rdf', id: 'aa-cv', country: 'Cabo Verde' },
  { name: 'AllAfrica Mauritania', url: 'https://allafrica.com/tools/headlines/rdf/mauritania/headlines.rdf', id: 'aa-mr', country: 'Mauritania' },
  { name: 'Sierra Leone Telegraph', url: 'https://www.thesierraleonetelegraph.com/feed/', id: 'sltelegraph-sl', country: 'Sierra Leone' },
  { name: 'FrontPageAfrica', url: 'https://frontpageafricaonline.com/feed/', id: 'fpa-lr', country: 'Liberia' },
  { name: 'The Point Gambia', url: 'https://thepoint.gm/feed', id: 'thepoint-gm', country: 'Gambia' },
  // Central Africa — underrepresented countries
  { name: 'AllAfrica Central African Republic', url: 'https://allafrica.com/tools/headlines/rdf/centralafricanrepublic/headlines.rdf', id: 'aa-cf', country: 'Central African Republic' },
  { name: 'AllAfrica Congo-Brazzaville', url: 'https://allafrica.com/tools/headlines/rdf/congo-brazzaville/headlines.rdf', id: 'aa-cg', country: 'Congo-Brazzaville' },
  { name: 'AllAfrica Equatorial Guinea', url: 'https://allafrica.com/tools/headlines/rdf/equatorialguinea/headlines.rdf', id: 'aa-gq', country: 'Equatorial Guinea' },
  { name: 'AllAfrica Gabon', url: 'https://allafrica.com/tools/headlines/rdf/gabon/headlines.rdf', id: 'aa-ga', country: 'Gabon' },
  { name: 'AllAfrica Sao Tome and Principe', url: 'https://allafrica.com/tools/headlines/rdf/saotomeandprincipe/headlines.rdf', id: 'aa-st', country: 'Sao Tome and Principe' },

  // ═══════════════════════════════════════════
  // ─── MIDDLE EAST ───────────────────────────
  // ═══════════════════════════════════════════
  { name: 'The New Arab', url: 'https://www.newarab.com/rss.xml', id: 'newarab', country: null, sourceType: 'regional', coverageCountries: MENA_COVERAGE_COUNTRIES },
  { name: 'Al-Monitor', url: 'https://www.al-monitor.com/rss', id: 'almonitor', country: null, sourceType: 'regional', coverageCountries: MENA_COVERAGE_COUNTRIES },
  { name: 'Daily Sabah Turkey', url: 'https://www.dailysabah.com/rssFeed/home', id: 'dailysabah-tr', country: 'Turkey' },
  { name: 'Arab News Saudi', url: 'https://www.arabnews.com/rss.xml', id: 'arabnews-sa', country: 'Saudi Arabia' },
  { name: 'Gulf News UAE', url: 'https://gulfnews.com/rss', id: 'gulfnews-ae', country: 'United Arab Emirates' },
  { name: 'Khaleej Times UAE', url: 'https://www.khaleejtimes.com/rss', id: 'khaleejtimes-ae', country: 'United Arab Emirates' },
  { name: 'Jordan Times', url: 'https://www.jordantimes.com/rss.xml', id: 'jordantimes-jo', country: 'Jordan' },
  { name: 'Daily Star Lebanon', url: 'https://www.dailystar.com.lb/RSS.aspx', id: 'dailystar-lb', country: 'Lebanon' },
  { name: 'Tehran Times', url: 'https://www.tehrantimes.com/rss', id: 'tehrantimes-ir', country: 'Iran' },
  { name: 'Times of Israel', url: 'https://www.timesofisrael.com/feed/', id: 'toi-il', country: 'Israel' },
  { name: 'Jerusalem Post', url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx', id: 'jpost-il', country: 'Israel' },
  { name: 'Gulf Times Qatar', url: 'https://www.gulf-times.com/rss', id: 'gulftimes-qa', country: 'Qatar' },
  { name: 'Arab Times Kuwait', url: 'https://www.arabtimesonline.com/feed/', id: 'arabtimes-kw', country: 'Kuwait' },
  // MENA — underrepresented countries and additional Libya outlets
  { name: 'Times of Oman', url: 'https://timesofoman.com/feed/oman', id: 'timesofoman-om', country: 'Oman' },
  { name: 'Oman Observer', url: 'https://www.omanobserver.om/rss', id: 'omanobserver-om', country: 'Oman' },
  { name: 'Muscat Daily', url: 'https://www.muscatdaily.com/feed/', id: 'muscatdaily-om', country: 'Oman' },
  { name: 'Daily Tribune Bahrain', url: 'https://dt.bh/feed/', id: 'dailytribune-bh', country: 'Bahrain' },
  { name: 'News of Bahrain', url: 'https://www.newsofbahrain.com/rss/all.xml', id: 'newsofbahrain-bh', country: 'Bahrain' },
  { name: 'Bahrain News Agency', url: 'https://www.bna.bh/en/rss', id: 'bna-bh', country: 'Bahrain' },
  { name: 'Libya Herald', url: 'https://libyaherald.com/feed/', id: 'libyaherald-ly', country: 'Libya' },
  { name: 'Libya Observer', url: 'https://libyaobserver.ly/feed', id: 'libyaobserver-ly', country: 'Libya' },
  { name: 'Libyan Express', url: 'https://www.libyanexpress.com/feed/', id: 'libyanexpress-ly', country: 'Libya' },

  // ═══════════════════════════════════════════
  // ─── ASIA ──────────────────────────────────
  // ═══════════════════════════════════════════
  { name: 'The Diplomat', url: 'https://thediplomat.com/feed/', id: 'diplomat-asia', country: null, sourceType: 'regional', coverageCountries: ASIA_COVERAGE_COUNTRIES },
  { name: 'NDTV India', url: 'https://feeds.feedburner.com/ndtvnews-top-stories', id: 'ndtv', country: 'India' },
  { name: 'Times of India', url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms', id: 'toi', country: 'India' },
  { name: 'Hindustan Times', url: 'https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml', id: 'ht-in', country: 'India' },
  { name: 'Japan Times', url: 'https://www.japantimes.co.jp/feed/', id: 'japantimes', country: 'Japan' },
  { name: 'Korea Herald', url: 'https://www.koreaherald.com/common/rss_xml.php?ct=102', id: 'koreaherald', country: 'South Korea' },
  { name: 'Rappler Philippines', url: 'https://www.rappler.com/feed/', id: 'rappler-ph', country: 'Philippines' },
  { name: 'Dawn Pakistan', url: 'https://www.dawn.com/feed', id: 'dawn-pk', country: 'Pakistan' },
  { name: 'Daily Star Bangladesh', url: 'https://www.thedailystar.net/frontpage/rss.xml', id: 'dailystar-bd', country: 'Bangladesh' },
  { name: 'Khaama Press', url: 'https://www.khaama.com/feed/', id: 'khaama-af', country: 'Afghanistan' },
  { name: 'Kathmandu Post', url: 'https://kathmandupost.com/rss', id: 'kathmandupost-np', country: 'Nepal' },
  { name: 'The Irrawaddy', url: 'https://www.irrawaddy.com/feed', id: 'irrawaddy-mm', country: 'Myanmar' },
  { name: 'Straits Times Singapore', url: 'https://www.straitstimes.com/news/asia/rss.xml', id: 'straitstimes-sg', country: 'Singapore' },
  { name: 'Bangkok Post', url: 'https://www.bangkokpost.com/rss/data/topstories.xml', id: 'bangkokpost-th', country: 'Thailand' },
  { name: 'South China Morning Post', url: 'https://www.scmp.com/rss/91/feed', id: 'scmp', country: 'China' },
  { name: 'Taipei Times', url: 'https://www.taipeitimes.com/xml/index.rss', id: 'taipeitimes-tw', country: 'Taiwan' },
  { name: 'Jakarta Post', url: 'https://www.thejakartapost.com/rss', id: 'jakartapost-id', country: 'Indonesia' },
  { name: 'Malay Mail', url: 'https://www.malaymail.com/feed/rss/malaysia', id: 'malaymail-my', country: 'Malaysia' },
  { name: 'VnExpress International', url: 'https://e.vnexpress.net/rss/news.rss', id: 'vnexpress-vn', country: 'Vietnam' },
  { name: 'Khmer Times', url: 'https://www.khmertimeskh.com/feed/', id: 'khmertimes-kh', country: 'Cambodia' },
  { name: 'Laotian Times', url: 'https://laotiantimes.com/feed/', id: 'laotiantimes-la', country: 'Laos' },
  { name: 'Daily Mirror Sri Lanka', url: 'https://www.dailymirror.lk/rss', id: 'dailymirror-lk', country: 'Sri Lanka' },
  { name: 'Astana Times', url: 'https://astanatimes.com/feed/', id: 'astanatimes-kz', country: 'Kazakhstan' },

  // ═══════════════════════════════════════════
  // ─── EUROPE ────────────────────────────────
  // ═══════════════════════════════════════════
  { name: 'OC Media', url: 'https://oc-media.org/feed/', id: 'ocmedia', country: null, sourceType: 'regional', coverageCountries: CAUCASUS_COVERAGE_COUNTRIES },
  { name: 'Balkan Insight', url: 'https://balkaninsight.com/feed/', id: 'balkaninsight', country: null, sourceType: 'regional', coverageCountries: BALKANS_COVERAGE_COUNTRIES },
  { name: 'Telegraph UK', url: 'https://www.telegraph.co.uk/rss.xml', id: 'telegraph-uk', country: 'United Kingdom' },
  { name: 'Irish Times', url: 'https://www.irishtimes.com/cmlink/news-1.1319192', id: 'irishtimes-ie', country: 'Ireland' },
  { name: 'ANSA Italy', url: 'https://www.ansa.it/english/news/rss.xml', id: 'ansa-it', country: 'Italy' },
  { name: 'Moscow Times', url: 'https://www.themoscowtimes.com/rss/news', id: 'moscowtimes-ru', country: 'Russia' },
  { name: 'Kyiv Independent', url: 'https://kyivindependent.com/feed/', id: 'kyivindependent-ua', country: 'Ukraine' },
  // The Local network (English-language European news)
  { name: 'The Local Spain', url: 'https://feeds.thelocal.com/rss/es', id: 'thelocal-es', country: 'Spain' },
  { name: 'The Local Sweden', url: 'https://feeds.thelocal.com/rss/se', id: 'thelocal-se', country: 'Sweden' },
  { name: 'The Local Norway', url: 'https://feeds.thelocal.com/rss/no', id: 'thelocal-no', country: 'Norway' },
  { name: 'The Local Denmark', url: 'https://feeds.thelocal.com/rss/dk', id: 'thelocal-dk', country: 'Denmark' },
  { name: 'The Local Switzerland', url: 'https://feeds.thelocal.com/rss/ch', id: 'thelocal-ch', country: 'Switzerland' },
  { name: 'The Local Austria', url: 'https://feeds.thelocal.com/rss/at', id: 'thelocal-at', country: 'Austria' },
  // Other European
  { name: 'NL Times', url: 'https://nltimes.nl/rssfeed', id: 'nltimes-nl', country: 'Netherlands' },
  { name: 'Helsinki Times', url: 'https://www.helsinkitimes.fi/?format=feed&type=rss', id: 'helsinkitimes-fi', country: 'Finland' },
  { name: 'Greek Reporter', url: 'https://greekreporter.com/feed/', id: 'greekreporter-gr', country: 'Greece' },
  { name: 'Portugal News', url: 'https://www.theportugalnews.com/rss', id: 'portugalnews-pt', country: 'Portugal' },
  { name: 'Romania Insider', url: 'https://www.romania-insider.com/feed', id: 'romaniainsider-ro', country: 'Romania' },
  { name: 'Prague Morning', url: 'https://praguemorning.cz/feed/', id: 'praguemorning-cz', country: 'Czech Republic' },
  { name: 'Daily News Hungary', url: 'https://dailynewshungary.com/feed/', id: 'dailynewshungary-hu', country: 'Hungary' },

  // ═══════════════════════════════════════════
  // ─── AMERICAS ──────────────────────────────
  // ═══════════════════════════════════════════
  { name: 'CBC News', url: 'https://www.cbc.ca/cmlink/rss-topstories', id: 'cbc-ca', country: 'Canada' },
  { name: 'Mexico News Daily', url: 'https://mexiconewsdaily.com/feed/', id: 'mxnewsdaily', country: 'Mexico' },
  { name: 'Rio Times Brazil', url: 'https://www.riotimesonline.com/feed/', id: 'riotimes-br', country: 'Brazil' },
  { name: 'Buenos Aires Times', url: 'https://www.batimes.com.ar/feed', id: 'batimes-ar', country: 'Argentina' },
  { name: 'Colombia Reports', url: 'https://colombiareports.com/feed/', id: 'colreports-co', country: 'Colombia' },
  { name: 'Caracas Chronicles', url: 'https://www.caracaschronicles.com/feed/', id: 'caracas-ve', country: 'Venezuela' },
  { name: 'Havana Times', url: 'https://havanatimes.org/feed/', id: 'havanatimes-cu', country: 'Cuba' },
  { name: 'Tico Times', url: 'https://ticotimes.net/feed', id: 'ticotimes-cr', country: 'Costa Rica' },
  { name: 'Dominican Today', url: 'https://dominicantoday.com/feed/', id: 'domtoday-do', country: 'Dominican Republic' },
  { name: 'Jamaica Gleaner', url: 'https://jamaica-gleaner.com/feed/rss.xml', id: 'gleaner-jm', country: 'Jamaica' },
  { name: 'Haiti Libre', url: 'https://www.haitilibre.com/rss-en.xml', id: 'haitilibre-ht', country: 'Haiti' },
  { name: 'Newsroom Panama', url: 'https://newsroompanama.com/feed', id: 'newsroom-pa', country: 'Panama' },
  // MercoPress — Southern Cone coverage
  { name: 'MercoPress Chile', url: 'https://en.mercopress.com/rss/chile', id: 'merco-cl', country: 'Chile' },
  { name: 'MercoPress Peru', url: 'https://en.mercopress.com/rss/peru', id: 'merco-pe', country: 'Peru' },
  { name: 'MercoPress Uruguay', url: 'https://en.mercopress.com/rss/uruguay', id: 'merco-uy', country: 'Uruguay' },
  { name: 'MercoPress Paraguay', url: 'https://en.mercopress.com/rss/paraguay', id: 'merco-py', country: 'Paraguay' },
  { name: 'MercoPress Bolivia', url: 'https://en.mercopress.com/rss/bolivia', id: 'merco-bo', country: 'Bolivia' },
  { name: 'MercoPress Ecuador', url: 'https://en.mercopress.com/rss/ecuador', id: 'merco-ec', country: 'Ecuador' },

  // ═══════════════════════════════════════════
  // ─── OCEANIA / PACIFIC ─────────────────────
  // ═══════════════════════════════════════════
  { name: 'ABC Australia', url: 'https://www.abc.net.au/news/feed/2942460/rss.xml', id: 'abc-au', country: 'Australia' },
  { name: 'Sydney Morning Herald', url: 'https://www.smh.com.au/rss/feed.xml', id: 'smh-au', country: 'Australia' },
  { name: 'NZ Herald', url: 'https://www.nzherald.co.nz/arc/outboundfeeds/rss/curated/78/?outputType=xml', id: 'nzherald-nz', country: 'New Zealand' },
  { name: 'RNZ New Zealand', url: 'https://www.rnz.co.nz/rss/national.xml', id: 'rnz-nz', country: 'New Zealand' },
  { name: 'Loop PNG', url: 'https://www.looppng.com/rss.xml', id: 'loop-pg', country: 'Papua New Guinea' },
  { name: 'Islands Business', url: 'https://islandsbusiness.com/feed/', id: 'islands-fj', country: 'Fiji', coverageCountries: PACIFIC_COVERAGE_COUNTRIES },
];

// Cache + fetch lock (prevents StrictMode double-fetch)
let cachedArticles = null;
let cacheTimestamp = 0;
let fetchInProgress = null;
const CACHE_TTL = 5 * 60 * 1000;
export const ALL_RSS_FEEDS = [...OFFICIAL_FEEDS, ...RSS_FEEDS]
  .filter((feed) => !DISABLED_FEED_IDS.has(feed.id));

function createEmptyRssHealth() {
  return {
    lastUpdated: null,
    fromCache: false,
    totalFeeds: 0,
    healthyFeeds: 0,
    emptyFeeds: 0,
    failedFeeds: 0,
    articlesFound: 0,
    feeds: []
  };
}

let lastFetchHealth = createEmptyRssHealth();

function getFeedCoverageCountries(feed) {
  const coverageCountries = Array.isArray(feed?.coverageCountries)
    ? feed.coverageCountries.filter(Boolean)
    : [];

  return [...new Set(feed?.country ? [feed.country, ...coverageCountries] : coverageCountries)];
}

function getFeedCoverageIsos(feed) {
  return getFeedCoverageCountries(feed)
    .map((country) => countryToIso(country))
    .filter(Boolean);
}

function getTextContent(item, tagName) {
  const el = item.querySelector(tagName);
  return el ? el.textContent.trim() : '';
}

function getFirstText(item, selectors) {
  for (const selector of selectors) {
    const value = getTextContent(item, selector);
    if (value) return value;
  }
  return '';
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
  const media = item.querySelector('media\\:content, media\\:thumbnail, thumbnail');
  if (media?.getAttribute('url')) return media.getAttribute('url');

  const enclosure = item.querySelector('enclosure');
  if (enclosure?.getAttribute('url') && enclosure.getAttribute('type')?.startsWith('image')) {
    return enclosure.getAttribute('url');
  }

  return null;
}

function getFeedLink(item) {
  const atomLink = item.querySelector('link[href]');
  if (atomLink?.getAttribute('href')) {
    return atomLink.getAttribute('href');
  }

  return getTextContent(item, 'link');
}

function getFeedDate(item) {
  return getFirstText(item, ['pubDate', 'published', 'updated']);
}

function getFeedSummary(item) {
  return stripHtml(getFirstText(item, ['description', 'summary', 'content', 'content\\:encoded']));
}

function normalizeRssArticle(item, feedConfig, index) {
  const title = getTextContent(item, 'title');
  if (!title) return null;

  const description = getFeedSummary(item);
  const link = getFeedLink(item);
  const pubDate = getFeedDate(item);

  const geo = geocodeArticle(title, feedConfig.country, description);
  if (!geo) return null;

  const severity = deriveSeverity(title, description);
  const category = deriveCategory(title);
  const iso = countryToIso(geo.region);
  const language = detectLanguage(`${title} ${description || ''}`, feedConfig.language || null);

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
    sourceCountry: feedConfig.country || null,
    sourceType: classifySourceType({
      source: feedConfig.name,
      sourceCountry: feedConfig.country,
      sourceType: feedConfig.sourceType
    }),
    language,
    geocodePrecision: geo.precision,
    geocodeMatchedOn: geo.matchedOn,
    socialimage: getMediaUrl(item),
    isLive: true
  };
}

async function fetchFeed(feed) {
  let lastError = 'Feed unavailable';

  for (const proxy of CORS_PROXIES) {
    try {
      const url = `${proxy}${encodeURIComponent(feed.url)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }

      const xmlText = await response.text();
      const doc = new DOMParser().parseFromString(xmlText, 'text/xml');

      if (doc.querySelector('parsererror')) {
        lastError = 'Feed parse error';
        continue;
      }

      let items = doc.querySelectorAll('item');
      if (items.length === 0) items = doc.querySelectorAll('entry');

      const articles = [];
      items.forEach((item, i) => {
        const article = normalizeRssArticle(item, feed, i);
        if (article) articles.push(article);
      });

      return {
        feedId: feed.id,
        name: feed.name,
        sourceType: feed.sourceType || null,
        country: feed.country || null,
        isoA2: feed.country ? countryToIso(feed.country) || null : null,
        coverageCountries: getFeedCoverageCountries(feed),
        coverageIsoA2s: getFeedCoverageIsos(feed),
        status: articles.length > 0 ? 'ok' : 'empty',
        articleCount: articles.length,
        proxy,
        error: null,
        articles
      };
    } catch (error) {
      lastError = error.message || lastError;
      continue;
    }
  }
  return {
    feedId: feed.id,
    name: feed.name,
    sourceType: feed.sourceType || null,
    country: feed.country || null,
    isoA2: feed.country ? countryToIso(feed.country) || null : null,
    coverageCountries: getFeedCoverageCountries(feed),
    coverageIsoA2s: getFeedCoverageIsos(feed),
    status: 'failed',
    articleCount: 0,
    proxy: null,
    error: lastError,
    articles: []
  };
}

/**
 * Fetch feeds in batches to avoid overwhelming CORS proxies.
 */
async function fetchFeedsBatched(feeds, batchSize = 8, delayMs = 800) {
  const allArticles = [];
  const feedHealth = [];

  for (let i = 0; i < feeds.length; i += batchSize) {
    const batch = feeds.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(fetchFeed));

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allArticles.push(...result.value.articles);
        feedHealth.push({
          feedId: result.value.feedId,
          name: result.value.name,
          sourceType: result.value.sourceType,
          country: result.value.country,
          isoA2: result.value.isoA2,
          coverageCountries: result.value.coverageCountries,
          coverageIsoA2s: result.value.coverageIsoA2s,
          status: result.value.status,
          articleCount: result.value.articleCount,
          proxy: result.value.proxy,
          error: result.value.error
        });
        continue;
      }

      feedHealth.push({
        feedId: `batch-${i}`,
        name: 'Unknown feed',
        sourceType: null,
        country: null,
        isoA2: null,
        coverageCountries: [],
        coverageIsoA2s: [],
        status: 'failed',
        articleCount: 0,
        proxy: null,
        error: result.reason?.message || 'Feed batch failed'
      });
    }

    // Delay between batches (skip after last batch)
    if (i + batchSize < feeds.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return {
    articles: allArticles,
    feedHealth
  };
}

/**
 * Fetch news from all RSS feeds with batched requests.
 * Uses a fetch lock to prevent concurrent fetches (e.g. React StrictMode).
 */
export async function fetchRssNews() {
  const now = Date.now();

  if (cachedArticles && (now - cacheTimestamp) < CACHE_TTL) {
    lastFetchHealth = {
      ...lastFetchHealth,
      fromCache: true
    };
    return cachedArticles;
  }

  // Return existing fetch if one is already in progress
  if (fetchInProgress) return fetchInProgress;

  fetchInProgress = (async () => {
    try {
      const { articles, feedHealth } = await fetchFeedsBatched(ALL_RSS_FEEDS);
      articles.sort((a, b) => b.severity - a.severity);
      lastFetchHealth = {
        lastUpdated: new Date().toISOString(),
        fromCache: false,
        totalFeeds: ALL_RSS_FEEDS.length,
        healthyFeeds: feedHealth.filter((feed) => feed.status === 'ok').length,
        emptyFeeds: feedHealth.filter((feed) => feed.status === 'empty').length,
        failedFeeds: feedHealth.filter((feed) => feed.status === 'failed').length,
        articlesFound: articles.length,
        feeds: feedHealth
      };
      cachedArticles = articles;
      cacheTimestamp = Date.now();
      return articles;
    } finally {
      fetchInProgress = null;
    }
  })();

  return fetchInProgress;
}

export function getRssFetchHealth() {
  return lastFetchHealth;
}

export function clearRssCache() {
  cachedArticles = null;
  cacheTimestamp = 0;
  lastFetchHealth = createEmptyRssHealth();
}
