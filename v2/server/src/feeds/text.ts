import { decodeHTML } from 'entities';

const BLOCK_TAGS = /<(script|style|noscript|iframe|svg|template)\b[\s\S]*?<\/\1\s*>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
const BREAKS = /<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/blockquote)\b[^>]*>/gi;
const TAGS = /<\/?[A-Za-z][^>]*>/g;
const LOOKS_LIKE_HTML = /<\/?[A-Za-z][^>]*>|&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i;

function stripOnce(s: string): string {
  return decodeHTML(
    s
      .replace(CDATA, '$1')
      .replace(COMMENTS, ' ')
      .replace(BLOCK_TAGS, ' ')
      .replace(BREAKS, ' \n ')
      .replace(TAGS, ' '),
  );
}

/**
 * Plain text from feed HTML. Feeds often entity-escape their HTML, so after
 * one pass a second pass runs only if markup is still visible.
 */
export function htmlToText(input: string | undefined | null): string {
  if (!input) return '';
  let s = stripOnce(String(input));
  if (LOOKS_LIKE_HTML.test(s)) s = stripOnce(s);
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[  -​  　]/g, ' ')
    .replace(/[ \t\r\f\v]*\n[\s]*/g, '\n')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n+/g, ' ')
    .trim();
}

/** Cut at a word boundary to at most `max` code points, without splitting surrogate pairs. */
export function truncate(s: string, max: number): string {
  const cps = Array.from(s);
  if (cps.length <= max) return s;
  const cut = cps.slice(0, max).join('');
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd();
}
