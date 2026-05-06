import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHtmlSourceItems, extractArticleBody } from '../server/htmlSourceParser.js';

test('parseHtmlSourceItems extracts article entries from JSON-LD', () => {
  const html = `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "NewsArticle",
                "headline": "Malawi court issues ruling on election dispute",
                "url": "/news/malawi-court-ruling",
                "description": "A local court ruling has renewed debate in Lilongwe.",
                "datePublished": "2026-03-19T08:30:00Z",
                "image": "/images/ruling.jpg"
              }
            ]
          }
        </script>
      </head>
    </html>
  `;

  const items = parseHtmlSourceItems(html, 'https://example.com/');

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Malawi court issues ruling on election dispute');
  assert.equal(items[0].link, 'https://example.com/news/malawi-court-ruling');
  assert.equal(items[0].mediaUrl, 'https://example.com/images/ruling.jpg');
});

test('parseHtmlSourceItems falls back to article blocks when JSON-LD is unavailable', () => {
  const html = `
    <html>
      <body>
        <article>
          <h2><a href="/story/burundi-flooding">Burundi flooding leaves dozens displaced</a></h2>
          <time datetime="2026-03-18T21:00:00Z">March 18</time>
          <p>Authorities say several provinces are affected after heavy rain.</p>
          <img src="/media/flood.jpg" />
        </article>
      </body>
    </html>
  `;

  const items = parseHtmlSourceItems(html, 'https://news.example/');

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Burundi flooding leaves dozens displaced');
  assert.equal(items[0].link, 'https://news.example/story/burundi-flooding');
  assert.equal(items[0].summary, 'Authorities say several provinces are affected after heavy rain.');
});

// ── Readability-style body extraction tests ───────────────────────────────────

test('extractArticleBody extracts article content and strips nav/footer/sidebar', () => {
  const html = `
    <html>
      <head><title>News Site</title></head>
      <body>
        <nav>
          <ul><li><a href="/">Home</a></li><li><a href="/world">World</a></li></ul>
        </nav>
        <header>
          <h1>Site Header</h1>
          <p>Tagline and navigation</p>
        </header>
        <main>
          <article>
            <h1>Earthquake Devastates Coastal Region</h1>
            <p>A powerful earthquake measuring 7.2 on the Richter scale struck the coastal region early Tuesday morning, causing widespread damage to infrastructure and leaving thousands homeless.</p>
            <p>Emergency response teams have been deployed to the affected areas, with the national disaster management agency coordinating rescue operations across multiple districts.</p>
            <p>Local hospitals are overwhelmed with injured residents, and temporary shelters have been set up in schools and community centers to accommodate displaced families.</p>
          </article>
        </main>
        <aside class="sidebar">
          <div class="widget"><h3>Related Stories</h3></div>
          <div class="advertisement">Ad content here</div>
        </aside>
        <footer>
          <p>Copyright 2026 News Site. All rights reserved.</p>
          <nav><a href="/about">About</a> | <a href="/contact">Contact</a></nav>
        </footer>
      </body>
    </html>
  `;

  const result = extractArticleBody(html);

  assert.ok(result.bodyText.length > 0, 'should extract article body text');
  assert.ok(result.paragraphs.length >= 2, 'should extract multiple paragraphs');
  assert.ok(result.bodyText.toLowerCase().includes('earthquake'), 'should contain earthquake text');
  assert.ok(result.bodyText.toLowerCase().includes('emergency response'), 'should contain emergency response text');

  // Should NOT contain boilerplate content
  assert.ok(!result.bodyText.toLowerCase().includes('copyright 2026'), 'should not contain footer copyright');
  assert.ok(!result.bodyText.toLowerCase().includes('related stories'), 'should not contain sidebar content');
  assert.ok(!result.bodyText.toLowerCase().includes('tagline and navigation'), 'should not contain header tagline');
  assert.ok(!result.bodyText.toLowerCase().includes('ad content'), 'should not contain advertisement text');
});

test('extractArticleBody extracts from div-based article containers', () => {
  const html = `
    <html>
      <body>
        <nav>Navigation menu items here</nav>
        <div class="article-content">
          <p>The ceasefire agreement was signed after weeks of intense negotiations between the warring parties, marking a potential turning point in the decade-long conflict.</p>
          <p>International observers have welcomed the development, with the UN Secretary-General calling it a crucial step toward lasting peace in the region.</p>
        </div>
        <footer>Site footer with links and copyright</footer>
      </body>
    </html>
  `;

  const result = extractArticleBody(html);

  assert.ok(result.bodyText.length > 0, 'should extract article body text');
  assert.ok(result.bodyText.toLowerCase().includes('ceasefire agreement'), 'should contain article content');
  assert.ok(!result.bodyText.toLowerCase().includes('navigation menu'), 'should not contain nav content');
  assert.ok(!result.bodyText.toLowerCase().includes('site footer'), 'should not contain footer content');
});

test('extractArticleBody handles empty input gracefully', () => {
  const result = extractArticleBody('');
  assert.equal(result.bodyText, '');
  assert.deepEqual(result.paragraphs, []);
  assert.equal(result.method, 'empty');
});

test('extractArticleBody handles HTML with no article content', () => {
  const html = `
    <html>
      <body>
        <nav>Navigation</nav>
        <footer>Footer</footer>
      </body>
    </html>
  `;

  const result = extractArticleBody(html);
  // Should not crash — may produce empty or fallback output
  assert.ok(typeof result.bodyText === 'string');
  assert.ok(Array.isArray(result.paragraphs));
});

test('extractArticleBody strips elements with boilerplate class names', () => {
  const html = `
    <html>
      <body>
        <div class="sidebar widget-area">
          <p>Sidebar content that should not appear</p>
        </div>
        <div class="comments-section">
          <p>User comments here</p>
        </div>
        <article>
          <p>The main story about political developments in the capital continues to unfold as officials release new statements.</p>
          <p>Analysts say the situation remains fluid and further announcements are expected in the coming days.</p>
        </article>
        <div class="related-stories">
          <p>Related articles list</p>
        </div>
      </body>
    </html>
  `;

  const result = extractArticleBody(html);

  assert.ok(result.bodyText.toLowerCase().includes('political developments'), 'should contain article text');
  assert.ok(!result.bodyText.toLowerCase().includes('sidebar content'), 'should not contain sidebar content');
  assert.ok(!result.bodyText.toLowerCase().includes('user comments'), 'should not contain comments section');
  assert.ok(!result.bodyText.toLowerCase().includes('related articles'), 'should not contain related stories');
});

test('extractArticleBody identifies article content by id attribute', () => {
  const html = `
    <html>
      <body>
        <nav>Site navigation</nav>
        <div id="main-content">
          <p>Breaking news: diplomatic talks resume between the neighboring countries following months of tension along the disputed border region.</p>
          <p>Both sides have expressed cautious optimism about the negotiations, with mediators reporting progress on several key issues.</p>
        </div>
        <footer>Copyright notice</footer>
      </body>
    </html>
  `;

  const result = extractArticleBody(html);

  assert.ok(result.bodyText.toLowerCase().includes('diplomatic talks'), 'should contain article text');
  assert.ok(!result.bodyText.toLowerCase().includes('site navigation'), 'should not contain nav');
  assert.ok(!result.bodyText.toLowerCase().includes('copyright notice'), 'should not contain footer');
});
