import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHtmlSourceItems } from '../server/htmlSourceParser.js';

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
