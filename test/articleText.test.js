import test from 'node:test';
import assert from 'node:assert/strict';
import { getArticleTextPreview, normalizeArticleText, stripHtmlTags } from '../src/utils/articleText.js';

test('stripHtmlTags removes markup and decodes common entities', () => {
  const text = stripHtmlTags('<p>Flooding &amp; landslides hit <strong>northern</strong> districts&nbsp;</p>');

  assert.equal(text.includes('<strong>'), false);
  assert.equal(text.includes('&amp;'), false);
  assert.equal(text.replace(/\s+/g, ' ').trim(), 'Flooding & landslides hit northern districts');
});

test('normalizeArticleText collapses whitespace after stripping html', () => {
  const text = normalizeArticleText('<div>Flooding\n\n in <em>Lagos</em> </div>');

  assert.equal(text, 'Flooding in Lagos');
});

test('getArticleTextPreview truncates long text without trailing partial words', () => {
  const preview = getArticleTextPreview(
    'Emergency teams are clearing blocked roads while rural clinics wait for delayed fuel deliveries.',
    54
  );

  assert.equal(preview.truncated, true);
  assert.equal(preview.text, 'Emergency teams are clearing blocked roads while…');
});
