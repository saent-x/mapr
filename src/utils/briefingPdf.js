/**
 * briefingPdf.js — generates a structured PDF briefing report.
 *
 * Uses html2canvas (map snapshot) + jsPDF for a multi-page report containing:
 *  - Title page with ISO-8601 timestamp and filter summary
 *  - Map snapshot image
 *  - Severity distribution chart (drawn on canvas)
 *  - Event table
 *  - Entity list
 *  - Theme-aware (reads CSS custom properties for light/dark)
 */

import { jsPDF } from 'jspdf';
import { severityLabel, buildFilterSummary } from './briefingMarkdown.js';

const SEVERITY_TIERS = [
  { label: 'Critical', min: 85, color: [210, 87, 87] },
  { label: 'Elevated', min: 60, color: [217, 164, 65] },
  { label: 'Watch', min: 35, color: [94, 194, 105] },
  { label: 'Low', min: 0, color: [140, 140, 140] },
];

/**
 * Detects current theme from document body.
 * @returns {'dark'|'light'}
 */
function detectTheme() {
  if (typeof document === 'undefined') return 'dark';
  const cls = document.documentElement.className || '';
  if (cls.includes('light') || cls.includes('theme-light')) return 'light';
  // Check for light theme via CSS variable
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-0').trim();
  if (bg && (bg.startsWith('#f') || bg.startsWith('rgb(2') || bg.includes('255'))) return 'light';
  return 'dark';
}

/**
 * Draws a severity distribution chart on a canvas.
 * Returns the canvas for embedding in PDF.
 * @param {object[]} events
 * @param {boolean} isDark
 * @returns {HTMLCanvasElement}
 */
function drawSeverityChart(events, isDark) {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 250;
  const ctx = canvas.getContext('2d');

  const bgColor = isDark ? '#1a1a2e' : '#ffffff';
  const textColor = isDark ? '#e0e0e0' : '#333333';
  const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Count severity tiers
  const counts = SEVERITY_TIERS.map((tier) => {
    return events.filter((e) => severityLabel(e.severity || 0) === tier.label).length;
  });
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const maxCount = Math.max(...counts, 1);

  // Draw bars
  const barWidth = 60;
  const gap = 20;
  const chartLeft = 70;
  const chartBottom = 200;
  const chartHeight = 150;

  counts.forEach((count, i) => {
    const barHeight = (count / maxCount) * chartHeight;
    const x = chartLeft + i * (barWidth + gap);
    const y = chartBottom - barHeight;

    // Bar
    ctx.fillStyle = `rgb(${SEVERITY_TIERS[i].color.join(',')})`;
    ctx.fillRect(x, y, barWidth, barHeight);

    // Count label on top
    ctx.fillStyle = textColor;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(count), x + barWidth / 2, y - 8);

    // Percentage
    const pct = Math.round((count / total) * 100);
    ctx.font = '10px monospace';
    ctx.fillStyle = isDark ? '#999' : '#666';
    ctx.fillText(`${pct}%`, x + barWidth / 2, y - 22);

    // Tier label below
    ctx.fillStyle = textColor;
    ctx.font = '10px monospace';
    ctx.fillText(SEVERITY_TIERS[i].label.toUpperCase(), x + barWidth / 2, chartBottom + 16);
  });

  // Y-axis gridlines
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = chartBottom - (i / 4) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(chartLeft - 5, y);
    ctx.lineTo(chartLeft + 4 * (barWidth + gap) - gap, y);
    ctx.stroke();
  }

  // Title
  ctx.fillStyle = textColor;
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('SEVERITY DISTRIBUTION', chartLeft - 10, 25);

  return canvas;
}

/**
 * Draws a table of events onto the PDF document.
 * @param {jsPDF} doc
 * @param {object[]} events
 * @param {number} startY
 * @param {number} pageWidth
 */
function drawEventTable(doc, events, startY, pageWidth) {
  const margin = 15;
  const colWidths = [12, 70, 30, 25, 20];
  const colX = [
    margin,
    margin + colWidths[0],
    margin + colWidths[0] + colWidths[1],
    margin + colWidths[0] + colWidths[1] + colWidths[2],
    margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3],
  ];

  let y = startY;

  // Header
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text('#', colX[0], y);
  doc.text('Title', colX[1], y);
  doc.text('Severity', colX[2], y);
  doc.text('Region', colX[3], y);
  doc.text('Sources', colX[4], y);
  y += 6;

  doc.setDrawColor(80);
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;

  doc.setTextColor(60);
  doc.setFontSize(7);

  const maxEvents = Math.min(events.length, 40);
  for (let i = 0; i < maxEvents; i++) {
    const event = events[i];
    if (y > 270) {
      doc.addPage();
      y = 20;
    }

    const title = (event.title || 'Untitled').slice(0, 45);
    const sev = String(event.severity || 0);
    const region = (event.isoA2 || event.region || '—').slice(0, 12);
    const sources = String(event.articleCount || 1);

    doc.text(String(i + 1), colX[0], y);
    doc.text(title, colX[1], y);
    doc.text(sev, colX[2], y);
    doc.text(region, colX[3], y);
    doc.text(sources, colX[4], y);

    y += 5;
  }
}

/**
 * Generates and saves a PDF briefing report.
 *
 * @param {object[]} events - filtered event array
 * @param {object} filters - active filter state
 * @param {object} [options]
 * @param {HTMLElement} [options.mapElement] - map container element for html2canvas capture
 * @param {function} [options.onSuccess] - callback after successful save
 * @param {function} [options.onError] - callback on error
 */
export async function generateBriefingPdf(events = [], filters = {}, options = {}) {
  const { mapElement, onSuccess, onError } = options;

  try {
    const isDark = detectTheme();
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    let y = 20;

    // ── Title ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(217, 164, 65); // amber
    doc.text('MAPR Intelligence Briefing', margin, y);
    y += 10;

    // ── Timestamp ──
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(isDark ? 180 : 100);
    doc.text(`Generated: ${new Date().toISOString()}`, margin, y);
    y += 6;

    // ── Filter summary ──
    const filterText = buildFilterSummary(filters);
    doc.setFontSize(8);
    doc.setTextColor(isDark ? 150 : 80);
    const filterLines = doc.splitTextToSize(`Active Filters: ${filterText}`, pageWidth - margin * 2);
    doc.text(filterLines, margin, y);
    y += filterLines.length * 4 + 4;

    // ── Severity counts ──
    const severityCounts = {};
    for (const tier of SEVERITY_TIERS) {
      severityCounts[tier.label] = events.filter((e) => severityLabel(e.severity || 0) === tier.label).length;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(isDark ? 220 : 40);
    doc.text('Severity Summary', margin, y);
    y += 7;

    doc.setFontSize(9);
    doc.setTextColor(isDark ? 180 : 60);
    const sevText = SEVERITY_TIERS.map(
      (t) => `${t.label}: ${severityCounts[t.label]}`
    ).join('  |  ');
    doc.text(sevText, margin, y);
    y += 8;

    // ── Stats line ──
    const regions = new Set();
    let totalSources = 0;
    for (const event of events) {
      if (event.isoA2) regions.add(event.isoA2);
      else if (event.region) regions.add(event.region);
      totalSources += event.articleCount || 1;
    }
    doc.setFontSize(8);
    doc.setTextColor(isDark ? 150 : 80);
    doc.text(`Events: ${events.length}  |  Regions: ${regions.size}  |  Sources: ${totalSources}`, margin, y);
    y += 10;

    // ── Severity chart ──
    if (events.length > 0) {
      const chartCanvas = drawSeverityChart(events, isDark);
      const chartImg = chartCanvas.toDataURL('image/png');
      const chartWidth = 120;
      const chartHeight = 75;
      const chartX = (pageWidth - chartWidth) / 2;

      if (y + chartHeight + 10 > pageHeight - 20) {
        doc.addPage();
        y = 20;
      }

      doc.addImage(chartImg, 'PNG', chartX, y, chartWidth, chartHeight);
      y += chartHeight + 6;
    }

    // ── Map snapshot ──
    if (mapElement && typeof window !== 'undefined') {
      try {
        const html2canvas = (await import('html2canvas')).default;
        const mapCanvas = await html2canvas(mapElement, {
          useCORS: true,
          allowTaint: true,
          backgroundColor: isDark ? '#1a1a2e' : '#ffffff',
          scale: 1.5,
          logging: false,
        });

        const mapWidth = pageWidth - margin * 2;
        const mapHeight = mapWidth * (mapCanvas.height / mapCanvas.width);

        if (y + mapHeight + 5 > pageHeight - 20) {
          doc.addPage();
          y = 20;
        }

        const mapImg = mapCanvas.toDataURL('image/jpeg', 0.85);
        doc.addImage(mapImg, 'JPEG', margin, y, mapWidth, Math.min(mapHeight, 100));
        y += Math.min(mapHeight, 100) + 8;
      } catch (mapErr) {
        console.warn('Map snapshot failed, continuing without map image:', mapErr.message);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text('(Map snapshot unavailable)', margin, y);
        y += 6;
      }
    }

    // ── Event table ──
    doc.addPage();
    y = 20;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(isDark ? 220 : 40);
    doc.text(`Event Table (${Math.min(events.length, 40)} of ${events.length})`, margin, y);
    y += 8;

    // Sort by severity descending
    const sortedEvents = [...events].sort((a, b) => (b.severity || 0) - (a.severity || 0));
    drawEventTable(doc, sortedEvents, y, pageWidth);

    // ── Entity list ──
    doc.addPage();
    y = 20;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(isDark ? 220 : 40);
    doc.text('Entity Mentions', margin, y);
    y += 8;

    const entityMap = new Map();
    for (const event of events) {
      const entities = event.entities || event.enrichedEntities || [];
      for (const entity of entities) {
        const name = entity.name?.trim() || entity.text?.trim();
        if (!name || name.length < 2) continue;
        const key = `${name.toLowerCase()}::${entity.type || 'unknown'}`;
        if (!entityMap.has(key)) {
          entityMap.set(key, { name, type: entity.type || 'unknown', count: 0 });
        }
        entityMap.get(key).count++;
      }
    }
    const sortedEntities = Array.from(entityMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);

    if (sortedEntities.length > 0) {
      const colWidthsE = [65, 25, 20];
      const colXE = [margin, margin + colWidthsE[0], margin + colWidthsE[0] + colWidthsE[1]];

      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text('Entity', colXE[0], y);
      doc.text('Type', colXE[1], y);
      doc.text('Events', colXE[2], y);
      y += 6;

      doc.setDrawColor(80);
      doc.line(margin, y, pageWidth - margin, y);
      y += 4;

      doc.setFontSize(7);
      doc.setTextColor(60);
      for (const entity of sortedEntities) {
        if (y > 275) {
          doc.addPage();
          y = 20;
        }
        doc.text(entity.name.slice(0, 40), colXE[0], y);
        doc.text(entity.type.toUpperCase(), colXE[1], y);
        doc.text(String(entity.count), colXE[2], y);
        y += 5;
      }
    } else {
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text('No named entities found in filtered events.', margin, y);
    }

    // ── Save ──
    const filename = `mapr-briefing-${new Date().toISOString().slice(0, 10)}.pdf`;
    doc.save(filename);

    if (onSuccess) onSuccess();
    return { success: true, filename };
  } catch (err) {
    console.error('PDF generation failed:', err);
    if (onError) onError(err);
    return { success: false, error: err.message };
  }
}
