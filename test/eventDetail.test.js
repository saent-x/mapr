import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');

describe('Event Detail Page', () => {
  it('EventDetailPage.jsx exists in pages/', () => {
    const pagePath = join(SRC, 'pages', 'EventDetailPage.jsx');
    assert.ok(existsSync(pagePath), 'EventDetailPage.jsx must exist');
  });

  it('EventDetailPage.jsx has a default export', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('export default'), 'Must have a default export');
  });

  it('EventDetailPage uses useParams to read :id from url', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('useParams'), 'Must use useParams to read :id');
    assert.ok(src.includes('id'), 'Must reference the id parameter');
  });

  it('EventDetailPage uses useNavigate for back navigation', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('useNavigate'), 'Must use useNavigate hook');
    assert.ok(src.includes('navigate(-1)'), 'Must navigate(-1) for back button');
  });

  it('EventDetailPage renders back button with ArrowLeft icon', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('ArrowLeft'), 'Must render ArrowLeft icon for back button');
    assert.ok(
      src.includes('event-detail-back') || src.includes('handleBack'),
      'Must have back button handler',
    );
  });

  it('EventDetailPage imports FlatMap for map display', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('FlatMap'), 'Must import FlatMap component');
    assert.ok(src.includes('lazy'), 'Must lazy-load FlatMap via React.lazy');
  });

  it('EventDetailPage leads with event content instead of a map-first page', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    const layoutIndex = src.indexOf('<div className="event-detail-layout">');
    const titleIndex = src.indexOf('event-detail-title');
    const mapIndex = src.indexOf('event-detail-map');
    assert.ok(layoutIndex !== -1, 'Must render the event detail layout');
    assert.ok(titleIndex > layoutIndex, 'Event title should be in the primary detail layout');
    assert.ok(mapIndex > titleIndex, 'Location map should come after the main event content');
    assert.ok(src.includes('event-detail-location-section'), 'Map should be framed as a location context section');
  });

  it('EventDetailPage displays event severity, title, and summary', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('sev-pill'), 'Must render severity pill');
    assert.ok(src.includes('event.title'), 'Must render event title');
    assert.ok(src.includes('event.summary'), 'Must render event summary');
  });

  it('EventDetailPage displays metadata grid (source, date, confidence, etc.)', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('event-detail-grid'), 'Must render metadata grid');
    assert.ok(src.includes('event.source'), 'Must display source');
    assert.ok(src.includes('event.publishedAt'), 'Must display published date');
  });

  it('EventDetailPage shows source reliability when available', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('sourceCredibility'), 'Must reference sourceCredibility');
    assert.ok(src.includes('getReliabilityTier'), 'Must use reliability tier utility');
  });

  it('EventDetailPage displays entity lists (orgs, people, locations)', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('event.entities'), 'Must reference event entities');
    assert.ok(src.includes('organizations'), 'Must display organizations');
    assert.ok(src.includes('people'), 'Must display people');
  });

  it('EventDetailPage links entity chips to typed entity explorer deep links', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('entityExplorerLink'), 'Must build typed entity explorer links');
    assert.ok(src.includes("entityExplorerLink('location'"), 'Location chips must include type=location');
    assert.ok(src.includes("entityExplorerLink('organization'"), 'Organization chips must include type=organization');
    assert.ok(src.includes("entityExplorerLink('person'"), 'Person chips must include type=person');
    assert.ok(src.includes('new URLSearchParams({ type, entity: name })'), 'Must encode entity link params safely');
  });

  it('EventDetailPage shows related events using getRelatedEvents', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('getRelatedEvents'), 'Must use getRelatedEvents utility');
    assert.ok(src.includes('relatedEvents'), 'Must compute related events');
  });

  it('EventDetailPage shows not-found state for invalid event IDs', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('notFound') || src.includes('NOT FOUND'), 'Must handle missing event');
    assert.ok(src.includes('Back to Map'), 'Must link back to map from not-found state');
  });

  it('EventDetailPage waits for event data before showing not-found', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('dataSource'), 'Must read dataSource from news store');
    assert.ok(src.includes('loadLiveData'), 'Must be able to request event data');
    assert.ok(src.includes('waitingForEvents'), 'Must render a loading state before not-found');
    assert.ok(src.includes("t('eventDetail.loading'"), 'Must localize loading event state');
  });

  it('EventDetailPage resolves the same canonical IDs used by feed links', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('canonicalizeArticles'), 'Must canonicalize live news before matching route id');
    assert.ok(
      src.includes('String(ev.id) === String(id)'),
      'Must compare route id against canonical event ids',
    );
  });

  it('EventDetailPage can render the routed event when store data is not loaded', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('useLocation'), 'Must read router state');
    assert.ok(src.includes('location.state?.event'), 'Must accept clicked event state');
    assert.ok(src.includes('canonicalizeArticles([routedEvent])'), 'Must normalize routed event fallback');
  });

  it('EventDetailPage uses i18n via useTranslation', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('useTranslation'), 'Must use useTranslation hook');
    assert.ok(src.includes("eventDetail."), 'Must use eventDetail i18n namespace');
  });

  it('/event/:id route is registered in main.jsx', () => {
    const src = readFileSync(join(SRC, 'main.jsx'), 'utf8');
    assert.ok(
      src.includes('path="/event/:id"') || src.includes("path='/event/:id'"),
      'Event detail route /event/:id must exist',
    );
    assert.ok(src.includes('EventDetailPage'), 'main.jsx must reference EventDetailPage');
    assert.ok(src.includes('lazy'), 'EventDetailPage must be lazy-loaded');
    assert.ok(src.includes('Suspense'), 'Must use Suspense for lazy loading');
  });

  it('/event/:id route is inside Layout wrapper', () => {
    const src = readFileSync(join(SRC, 'main.jsx'), 'utf8');
    // The route should be inside the <Route element={<Layout />}> block
    const layoutIndex = src.indexOf('element={<Layout');
    const eventRouteIndex = src.indexOf('path="/event/:id"') !== -1
      ? src.indexOf('path="/event/:id"')
      : src.indexOf("path='/event/:id'");
    assert.ok(eventRouteIndex > layoutIndex, 'Route must be inside Layout wrapper');
    // Ensure Layout's closing tag is after the route
    const closingLayout = src.indexOf('</Route>', layoutIndex);
    assert.ok(eventRouteIndex < closingLayout, 'Route must be inside Layout element');
  });

  it('NewsPanel imports useNavigate and links to /event/:id', () => {
    const src = readFileSync(join(SRC, 'components', 'NewsPanel.jsx'), 'utf8');
    assert.ok(src.includes('useNavigate'), 'NewsPanel must import useNavigate');
    assert.ok(
      src.includes('navigate(`/event/${encodeURIComponent(story.id)}`, { state: { event: story } })'),
      'NewsPanel must navigate to /event/:id',
    );
    assert.ok(src.includes('state={{ event: story }}'), 'Expanded detail link should carry event state');
    assert.ok(
      src.includes('VIEW FULL DETAIL') || src.includes('eventDetail.viewDetail'),
      'NewsPanel must have link to event detail',
    );
  });

  it('EntityExplorerPage links event mentions to /event/:id', () => {
    const src = readFileSync(join(SRC, 'pages', 'EntityExplorerPage.jsx'), 'utf8');
    assert.ok(src.includes('Link'), 'EntityExplorerPage must import Link');
    assert.ok(
      src.includes('to={`/event/${ev.id}`}'),
      'EntityExplorerPage must link events to /event/:id',
    );
  });

  it('eventDetail i18n keys exist in all 5 locale files', () => {
    const locales = ['en', 'es', 'fr', 'ar', 'zh'];
    const requiredKeys = [
      'back', 'viewDetail', 'notFound', 'notFoundHint', 'backToMap',
      'source', 'openArticle', 'published', 'firstSeen', 'region',
      'confidence', 'sourceReliability', 'sources', 'independent',
      'precision', 'supportingArticles', 'location', 'entities', 'locations',
      'organizations', 'people', 'relatedEvents', 'noRelatedEvents',
    ];

    for (const locale of locales) {
      const data = JSON.parse(readFileSync(join(SRC, 'i18n', 'locales', `${locale}.json`), 'utf8'));
      assert.ok(data.eventDetail, `eventDetail section must exist in ${locale}.json`);
      for (const key of requiredKeys) {
        assert.ok(
          data.eventDetail[key],
          `eventDetail.${key} must exist in ${locale}.json`,
        );
      }
    }
  });

  it('no hardcoded English strings in EventDetailPage', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    // All user-facing labels should go through t() or use i18n keys
    // Check that "Source" and "Confidence" labels use t()
    assert.ok(
      src.includes("t('eventDetail.source'") || src.includes('t("eventDetail.source"'),
      'Source label must use t()',
    );
    assert.ok(
      src.includes("t('eventDetail.confidence'") || src.includes('t("eventDetail.confidence"'),
      'Confidence label must use t()',
    );
  });

  it('EventDetailPage handles coordinate display correctly', () => {
    const src = readFileSync(join(SRC, 'pages', 'EventDetailPage.jsx'), 'utf8');
    assert.ok(src.includes('coordinates'), 'Must reference coordinates');
    assert.ok(
      src.includes('hasCoords') || src.includes('Array.isArray(event.coordinates)'),
      'Must check for valid coordinates',
    );
  });

  it('CSS includes event-detail-page styles', () => {
    const src = readFileSync(join(SRC, 'index.css'), 'utf8');
    assert.ok(src.includes('.event-detail-page'), 'index.css must contain .event-detail-page');
    assert.ok(src.includes('.event-detail-back'), 'index.css must contain .event-detail-back');
    assert.ok(src.includes('.event-detail-layout'), 'index.css must contain .event-detail-layout');
    assert.ok(src.includes('.event-detail-map'), 'index.css must contain .event-detail-map');
    assert.ok(src.includes('.event-detail-title'), 'index.css must contain .event-detail-title');
    assert.ok(src.includes('.event-detail-grid'), 'index.css must contain .event-detail-grid');
    assert.ok(
      src.includes('.event-detail-related-item') || src.includes('.event-detail-related-list'),
      'index.css must contain related events styles',
    );
    assert.ok(
      src.includes('.event-detail-entity-chip'),
      'index.css must contain entity chip styles',
    );
  });

  it('Event detail page owns vertical scrolling inside app shell', () => {
    const src = readFileSync(join(SRC, 'index.css'), 'utf8');
    const match = src.match(/\.event-detail-page\s*\{[\s\S]*?\}/);
    assert.ok(match, 'Must have event-detail-page CSS block');
    assert.match(match[0], /height:\s*100%/, 'Event detail page should fill app shell height');
    assert.match(match[0], /overflow-y:\s*auto/, 'Event detail page should scroll vertically');
  });
});
