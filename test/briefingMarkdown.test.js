import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBriefingMarkdown } from '../src/utils/briefingMarkdown.js';

test('generateBriefingMarkdown returns valid markdown with header', () => {
  const md = generateBriefingMarkdown([], {});
  assert.ok(md.startsWith('# Mapr Intelligence Briefing'));
  assert.ok(md.includes('**Events:** 0'));
});

test('generateBriefingMarkdown includes event title, severity, region, and source count', () => {
  const events = [
    { id: '1', title: 'Test Crisis', severity: 90, region: 'West Africa', articleCount: 5, firstSeenAt: '2025-01-15T10:00:00Z' },
    { id: '2', title: 'Minor Incident', severity: 20, region: 'Europe', articleCount: 1, firstSeenAt: '2025-01-15T12:00:00Z' },
  ];
  const md = generateBriefingMarkdown(events, {});
  assert.ok(md.includes('Test Crisis'));
  assert.ok(md.includes('90'));
  assert.ok(md.includes('West Africa'));
  assert.ok(md.includes('5'));
  assert.ok(md.includes('Minor Incident'));
  assert.ok(md.includes('Europe'));
});

test('generateBriefingMarkdown groups events by severity tier', () => {
  const events = [
    { id: '1', title: 'Critical Event', severity: 90, region: 'Africa', articleCount: 3 },
    { id: '2', title: 'Watch Event', severity: 40, region: 'Asia', articleCount: 1 },
    { id: '3', title: 'Low Event', severity: 10, region: 'Europe', articleCount: 1 },
  ];
  const md = generateBriefingMarkdown(events, {});
  assert.ok(md.includes('## Critical Events (1)'));
  assert.ok(md.includes('## Watch Events (1)'));
  assert.ok(md.includes('## Low Events (1)'));
});

test('generateBriefingMarkdown includes summary statistics', () => {
  const events = [
    { id: '1', title: 'A', severity: 90, region: 'Africa', isoA2: 'NG', articleCount: 4 },
    { id: '2', title: 'B', severity: 60, region: 'Asia', isoA2: 'IN', articleCount: 2 },
  ];
  const md = generateBriefingMarkdown(events, {});
  assert.ok(md.includes('| Total events | 2 |'));
  assert.ok(md.includes('| Total source articles | 6 |'));
  assert.ok(md.includes('| Critical | 1 |'));
  assert.ok(md.includes('| Elevated | 1 |'));
});

test('generateBriefingMarkdown includes filter summary when filters are active', () => {
  const md = generateBriefingMarkdown([], { dateWindow: '24h', minSeverity: 50 });
  assert.ok(md.includes('Time window: 24h'));
  assert.ok(md.includes('Min severity: 50'));
});

test('generateBriefingMarkdown handles events with missing fields gracefully', () => {
  const events = [
    { id: '1' },
    { id: '2', title: null, severity: undefined },
  ];
  const md = generateBriefingMarkdown(events, {});
  assert.ok(md.includes('Untitled'));
  assert.ok(typeof md === 'string');
});

test('generateBriefingMarkdown escapes pipe characters in titles', () => {
  const events = [
    { id: '1', title: 'Event | With Pipe', severity: 50, region: 'Test', articleCount: 1 },
  ];
  const md = generateBriefingMarkdown(events, {});
  assert.ok(md.includes('Event \\| With Pipe'));
  assert.ok(!md.includes('Event | With Pipe'));
});
