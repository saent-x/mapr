/**
 * Print View Tests — VAL-M6-025 through VAL-M6-028, VAL-CROSS-027, VAL-CROSS-028
 *
 * Tests:
 * - Print button exists in Header component
 * - @media print CSS rules exist in index.css
 * - Print forces light theme (white bg, black text)
 * - Navigation/sidebar hidden in print
 * - Event detail, region page, trends page print styles present
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const headerPath = resolve(projectRoot, 'src', 'components', 'Header.jsx');
const cssPath = resolve(projectRoot, 'src', 'index.css');

// ── VAL-M6-025: Print button exists in header ──

describe('VAL-M6-025: Print button in Header', () => {
  it('Header component file exists', () => {
    assert.ok(existsSync(headerPath));
  });

  it('Header imports Printer from lucide-react', () => {
    const src = readFileSync(headerPath, 'utf8');
    assert.ok(src.includes('Printer'), 'Header should import Printer icon');
  });

  it('Header has print button with onClick calling window.print()', () => {
    const src = readFileSync(headerPath, 'utf8');
    assert.ok(src.includes('window.print()'), 'Header should call window.print()');
  });

  it('Print button has aria-label referencing print i18n key', () => {
    const src = readFileSync(headerPath, 'utf8');
    assert.ok(
      src.includes('print.printButton'),
      'Print button should use t(\'print.printButton\')'
    );
  });

  it('Mobile menu also has print button', () => {
    const src = readFileSync(headerPath, 'utf8');
    const mobilePrintCount = (src.match(/window\.print\(\)/g) || []).length;
    assert.ok(mobilePrintCount >= 2, 'Both desktop and mobile should have print buttons');
  });

  it('Print button has header-print-btn class', () => {
    const src = readFileSync(headerPath, 'utf8');
    assert.ok(
      src.includes('header-print-btn'),
      'Print button should use header-print-btn CSS class'
    );
  });
});

// ── VAL-M6-026, VAL-M6-027, VAL-M6-028, VAL-CROSS-027, VAL-CROSS-028: @media print styles ──

describe('VAL-M6-026/027/028 + VAL-CROSS-027/028: @media print CSS rules', () => {
  it('index.css has @media print block', () => {
    const css = readFileSync(cssPath, 'utf8');
    assert.ok(css.includes('@media print'), 'index.css must contain @media print');
  });

  it('Print forces light background (white)', () => {
    const css = readFileSync(cssPath, 'utf8');
    const printSection = css.substring(css.indexOf('@media print'));
    assert.ok(
      printSection.includes('background: #ffffff') || printSection.includes('background:#ffffff'),
      'Print should force white background'
    );
  });

  it('Print forces black text color', () => {
    const css = readFileSync(cssPath, 'utf8');
    const printSection = css.substring(css.indexOf('@media print'));
    assert.ok(
      printSection.includes('color: #111111'),
      'Print should force dark/black text color'
    );
  });

  it('Print hides app-sidebar navigation', () => {
    const css = readFileSync(cssPath, 'utf8');
    const printSection = css.substring(css.indexOf('@media print'));
    assert.ok(
      printSection.includes('.app-sidebar'),
      'Print should hide sidebar navigation'
    );
  });

  it('Print hides app-status bar', () => {
    const css = readFileSync(cssPath, 'utf8');
    const printSection = css.substring(css.indexOf('@media print'));
    assert.ok(
      printSection.includes('.app-status'),
      'Print should hide status bar'
    );
  });

  it('Print hides mobile bottom nav', () => {
    const css = readFileSync(cssPath, 'utf8');
    const printSection = css.substring(css.indexOf('@media print'));
    assert.ok(
      printSection.includes('mobile-bottom-nav'),
      'Print should hide mobile bottom navigation'
    );
  });

  it('Print hides map zoom controls', () => {
    const css = readFileSync(cssPath, 'utf8');
    const printSection = css.substring(css.indexOf('@media print'));
    assert.ok(
      printSection.includes('map-zoom-controls'),
      'Print should hide map zoom controls'
    );
  });

  it('Print has event detail page styles', () => {
    const css = readFileSync(cssPath, 'utf8');
    const printSection = css.substring(css.indexOf('@media print'));
    assert.ok(
      printSection.includes('event-detail-page'),
      'Print should have event detail page styles'
    );
  });

  it('Print has region page styles', () => {
    const css = readFileSync(cssPath, 'utf8');
    const printSection = css.substring(css.indexOf('@media print'));
    assert.ok(
      printSection.includes('region-detail-page'),
      'Print should have region detail page styles'
    );
  });

  it('Print has trends page styles', () => {
    const css = readFileSync(cssPath, 'utf8');
    const printSection = css.substring(css.indexOf('@media print'));
    assert.ok(
      printSection.includes('trends-page'),
      'Print should have trends page styles'
    );
  });

  it('Print includes print-color-adjust: exact for accurate colors', () => {
    const css = readFileSync(cssPath, 'utf8');
    const printSection = css.substring(css.indexOf('@media print'));
    assert.ok(
      printSection.includes('print-color-adjust: exact') ||
      printSection.includes('-webkit-print-color-adjust: exact'),
      'Print should use print-color-adjust: exact'
    );
  });

  it('Print has page-break-inside: avoid for card components', () => {
    const css = readFileSync(cssPath, 'utf8');
    const printSection = css.substring(css.indexOf('@media print'));
    assert.ok(
      printSection.includes('page-break-inside: avoid'),
      'Print should avoid page breaks inside cards'
    );
  });
});

// ── Header CSS class exists ──

describe('Print button CSS', () => {
  it('header-print-btn CSS class defined in index.css', () => {
    const css = readFileSync(cssPath, 'utf8');
    assert.ok(
      css.includes('.header-print-btn'),
      'header-print-btn CSS class should exist'
    );
  });

  it('header-print-btn has hover state', () => {
    const css = readFileSync(cssPath, 'utf8');
    assert.ok(
      css.includes('.header-print-btn:hover'),
      'header-print-btn should have hover styling'
    );
  });
});

// ── i18n keys ──

describe('i18n print keys', () => {
  const locales = ['en', 'es', 'fr', 'ar', 'zh'];

  for (const locale of locales) {
    it(`print key exists in ${locale}.json`, () => {
      const localePath = resolve(projectRoot, 'src', 'i18n', 'locales', `${locale}.json`);
      assert.ok(existsSync(localePath), `${locale}.json should exist`);
      const json = JSON.parse(readFileSync(localePath, 'utf8'));
      assert.ok(json.print, `"print" key should exist in ${locale}.json`);
      assert.ok(
        typeof json.print.printButton === 'string' && json.print.printButton.length > 0,
        `print.printButton should be a non-empty string in ${locale}.json`
      );
      assert.ok(
        typeof json.print.printing === 'string' && json.print.printing.length > 0,
        `print.printing should be a non-empty string in ${locale}.json`
      );
    });
  }
});
