import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * Tests for the entity graph data transformation utilities.
 * These utilities extract entities from events and build a graph
 * structure (nodes + edges) for visualization.
 */

import {
  extractEntityGraph,
  filterGraphByType,
  getRelatedEvents,
  entityKey,
  findShortestPath,
  searchEntitiesByName,
} from '../src/utils/entityGraph.js';

/* ── Test fixtures ── */

const EVENTS = [
  {
    id: 'evt-1',
    title: 'UN condemns attacks in Syria',
    severity: 80,
    entities: {
      people: [{ name: 'Antonio Guterres', mentionCount: 2 }],
      organizations: [{ name: 'United Nations', mentionCount: 3 }],
      locations: [{ name: 'Syria', mentionCount: 2 }],
    },
  },
  {
    id: 'evt-2',
    title: 'NATO and UN discuss Ukraine peace plan',
    severity: 70,
    entities: {
      people: [{ name: 'Antonio Guterres', mentionCount: 1 }, { name: 'Jens Stoltenberg', mentionCount: 1 }],
      organizations: [{ name: 'United Nations', mentionCount: 1 }, { name: 'NATO', mentionCount: 2 }],
      locations: [{ name: 'Ukraine', mentionCount: 2 }],
    },
  },
  {
    id: 'evt-3',
    title: 'WHO warns of health crisis in Ukraine',
    severity: 60,
    entities: {
      people: [],
      organizations: [{ name: 'WHO', mentionCount: 1 }],
      locations: [{ name: 'Ukraine', mentionCount: 1 }],
    },
  },
  {
    id: 'evt-4',
    title: 'Peace talks in Geneva',
    severity: 50,
    entities: {
      people: [],
      organizations: [],
      locations: [{ name: 'Geneva', mentionCount: 1 }],
    },
  },
  {
    id: 'evt-5',
    title: 'No entities event',
    severity: 30,
    entities: null,
  },
  {
    id: 'evt-6',
    title: 'Empty entities event',
    severity: 20,
    entities: { people: [], organizations: [], locations: [] },
  },
];

describe('extractEntityGraph', () => {
  it('extracts nodes from event entities', () => {
    const graph = extractEntityGraph(EVENTS);
    assert.ok(graph.nodes.length > 0, 'should have nodes');
    // Should have: Antonio Guterres, Jens Stoltenberg, United Nations, NATO, WHO, Syria, Ukraine, Geneva
    const nodeNames = graph.nodes.map((n) => n.name);
    assert.ok(nodeNames.includes('Antonio Guterres'), 'should include person');
    assert.ok(nodeNames.includes('United Nations'), 'should include org');
    assert.ok(nodeNames.includes('Ukraine'), 'should include location');
  });

  it('assigns correct entity types to nodes', () => {
    const graph = extractEntityGraph(EVENTS);
    const guterres = graph.nodes.find((n) => n.name === 'Antonio Guterres');
    assert.equal(guterres.type, 'person');
    const un = graph.nodes.find((n) => n.name === 'United Nations');
    assert.equal(un.type, 'organization');
    const ukraine = graph.nodes.find((n) => n.name === 'Ukraine');
    assert.equal(ukraine.type, 'location');
  });

  it('counts total mentions across events', () => {
    const graph = extractEntityGraph(EVENTS);
    const guterres = graph.nodes.find((n) => n.name === 'Antonio Guterres');
    // mentionCount: 2 (evt-1) + 1 (evt-2) = 3
    assert.equal(guterres.mentionCount, 3);
    const un = graph.nodes.find((n) => n.name === 'United Nations');
    // 3 (evt-1) + 1 (evt-2) = 4
    assert.equal(un.mentionCount, 4);
  });

  it('tracks which events reference each entity', () => {
    const graph = extractEntityGraph(EVENTS);
    const guterres = graph.nodes.find((n) => n.name === 'Antonio Guterres');
    assert.deepEqual(guterres.eventIds.sort(), ['evt-1', 'evt-2']);
    const ukraine = graph.nodes.find((n) => n.name === 'Ukraine');
    assert.deepEqual(ukraine.eventIds.sort(), ['evt-2', 'evt-3']);
  });

  it('creates edges for entities co-occurring in the same event', () => {
    const graph = extractEntityGraph(EVENTS);
    assert.ok(graph.edges.length > 0, 'should have edges');
    // Antonio Guterres and United Nations co-occur in evt-1 and evt-2
    const guterresId = entityKey('person', 'Antonio Guterres');
    const unId = entityKey('organization', 'United Nations');
    const edge = graph.edges.find(
      (e) =>
        (e.source === guterresId && e.target === unId) ||
        (e.source === unId && e.target === guterresId)
    );
    assert.ok(edge, 'Guterres-UN edge should exist');
    assert.equal(edge.weight, 2, 'they co-occur in 2 events');
  });

  it('creates edges between different entity types that co-occur', () => {
    const graph = extractEntityGraph(EVENTS);
    // WHO and Ukraine co-occur in evt-3
    const whoId = entityKey('organization', 'WHO');
    const ukraineId = entityKey('location', 'Ukraine');
    const edge = graph.edges.find(
      (e) =>
        (e.source === whoId && e.target === ukraineId) ||
        (e.source === ukraineId && e.target === whoId)
    );
    assert.ok(edge, 'WHO-Ukraine edge should exist');
    assert.equal(edge.weight, 1);
  });

  it('assigns typed id to each node', () => {
    const graph = extractEntityGraph(EVENTS);
    const guterres = graph.nodes.find((n) => n.name === 'Antonio Guterres');
    assert.equal(guterres.id, 'person:antonio guterres');
    const un = graph.nodes.find((n) => n.name === 'United Nations');
    assert.equal(un.id, 'organization:united nations');
    const ukraine = graph.nodes.find((n) => n.name === 'Ukraine');
    assert.equal(ukraine.id, 'location:ukraine');
  });

  it('handles events with null or empty entities', () => {
    const graph = extractEntityGraph(EVENTS);
    // Should not crash, events without entities are simply skipped
    assert.ok(graph.nodes.length > 0);
    assert.ok(graph.edges.length > 0);
  });

  it('handles empty events array', () => {
    const graph = extractEntityGraph([]);
    assert.deepEqual(graph.nodes, []);
    assert.deepEqual(graph.edges, []);
  });

  it('handles null/undefined input', () => {
    const graph = extractEntityGraph(null);
    assert.deepEqual(graph.nodes, []);
    assert.deepEqual(graph.edges, []);
  });

  it('deduplicates entities by type + lowercase name', () => {
    const events = [
      {
        id: 'evt-a',
        entities: {
          people: [{ name: 'John Smith', mentionCount: 1 }],
          organizations: [],
          locations: [],
        },
      },
      {
        id: 'evt-b',
        entities: {
          people: [{ name: 'john smith', mentionCount: 1 }],
          organizations: [],
          locations: [],
        },
      },
    ];
    const graph = extractEntityGraph(events);
    const johns = graph.nodes.filter((n) => n.name.toLowerCase() === 'john smith');
    assert.equal(johns.length, 1, 'should deduplicate by type + lowercase name');
  });

  it('keeps entities with same name but different types as separate nodes', () => {
    // "Georgia" the organization and "Georgia" the location should remain distinct
    const events = [
      {
        id: 'evt-org',
        entities: {
          people: [],
          organizations: [{ name: 'Georgia', mentionCount: 2 }],
          locations: [],
        },
      },
      {
        id: 'evt-loc',
        entities: {
          people: [],
          organizations: [],
          locations: [{ name: 'Georgia', mentionCount: 3 }],
        },
      },
    ];
    const graph = extractEntityGraph(events);
    const georgias = graph.nodes.filter((n) => n.name === 'Georgia');
    assert.equal(georgias.length, 2, 'should have two separate Georgia nodes');
    const types = new Set(georgias.map((n) => n.type));
    assert.ok(types.has('organization'), 'one should be an organization');
    assert.ok(types.has('location'), 'one should be a location');
    // They should have different ids
    const ids = georgias.map((n) => n.id);
    assert.equal(ids.length, 2);
    assert.ok(ids.includes('organization:georgia'));
    assert.ok(ids.includes('location:georgia'));
    // Mention counts should be tracked separately
    const orgGeorgia = georgias.find((n) => n.type === 'organization');
    const locGeorgia = georgias.find((n) => n.type === 'location');
    assert.equal(orgGeorgia.mentionCount, 2);
    assert.equal(locGeorgia.mentionCount, 3);
    assert.deepEqual(orgGeorgia.eventIds, ['evt-org']);
    assert.deepEqual(locGeorgia.eventIds, ['evt-loc']);
  });

  it('creates edges between same-name different-type entities when they co-occur', () => {
    const events = [
      {
        id: 'evt-both',
        entities: {
          people: [],
          organizations: [{ name: 'Georgia', mentionCount: 1 }],
          locations: [{ name: 'Georgia', mentionCount: 1 }],
        },
      },
    ];
    const graph = extractEntityGraph(events);
    const georgias = graph.nodes.filter((n) => n.name === 'Georgia');
    assert.equal(georgias.length, 2, 'two Georgia nodes');
    // There should be an edge between them
    const orgId = entityKey('organization', 'Georgia');
    const locId = entityKey('location', 'Georgia');
    const edge = graph.edges.find(
      (e) =>
        (e.source === orgId && e.target === locId) ||
        (e.source === locId && e.target === orgId)
    );
    assert.ok(edge, 'edge between org Georgia and loc Georgia should exist');
    assert.equal(edge.weight, 1);
  });
});

describe('filterGraphByType', () => {
  it('filters nodes and edges by entity type', () => {
    const graph = extractEntityGraph(EVENTS);
    const filtered = filterGraphByType(graph, { people: true, organizations: false, locations: false });
    assert.ok(filtered.nodes.every((n) => n.type === 'person'));
    // Edges should only connect persons (edge source/target are typed ids)
    assert.ok(filtered.edges.every((e) => {
      const srcNode = filtered.nodes.find((n) => n.id === e.source);
      const tgtNode = filtered.nodes.find((n) => n.id === e.target);
      return srcNode && tgtNode;
    }));
  });

  it('includes multiple types when selected', () => {
    const graph = extractEntityGraph(EVENTS);
    const filtered = filterGraphByType(graph, { people: true, organizations: true, locations: false });
    const types = new Set(filtered.nodes.map((n) => n.type));
    assert.ok(types.has('person'));
    assert.ok(types.has('organization'));
    assert.ok(!types.has('location'));
  });

  it('returns full graph when all types enabled', () => {
    const graph = extractEntityGraph(EVENTS);
    const filtered = filterGraphByType(graph, { people: true, organizations: true, locations: true });
    assert.equal(filtered.nodes.length, graph.nodes.length);
    assert.equal(filtered.edges.length, graph.edges.length);
  });

  it('returns empty graph when no types enabled', () => {
    const graph = extractEntityGraph(EVENTS);
    const filtered = filterGraphByType(graph, { people: false, organizations: false, locations: false });
    assert.deepEqual(filtered.nodes, []);
    assert.deepEqual(filtered.edges, []);
  });

  it('filters same-name entities correctly when types differ', () => {
    // "Georgia" appears as both org and location
    const crossTypeEvents = [
      {
        id: 'evt-org',
        entities: {
          people: [],
          organizations: [{ name: 'Georgia', mentionCount: 1 }],
          locations: [],
        },
      },
      {
        id: 'evt-loc',
        entities: {
          people: [],
          organizations: [],
          locations: [{ name: 'Georgia', mentionCount: 1 }],
        },
      },
    ];
    const graph = extractEntityGraph(crossTypeEvents);
    // Filtering to locations-only should keep only the location Georgia
    const locOnly = filterGraphByType(graph, { people: false, organizations: false, locations: true });
    assert.equal(locOnly.nodes.length, 1);
    assert.equal(locOnly.nodes[0].type, 'location');
    assert.equal(locOnly.nodes[0].name, 'Georgia');
    // Filtering to orgs-only should keep only the org Georgia
    const orgOnly = filterGraphByType(graph, { people: false, organizations: true, locations: false });
    assert.equal(orgOnly.nodes.length, 1);
    assert.equal(orgOnly.nodes[0].type, 'organization');
    assert.equal(orgOnly.nodes[0].name, 'Georgia');
  });
});

describe('getRelatedEvents', () => {
  it('returns events that reference the given entity', () => {
    const related = getRelatedEvents(EVENTS, 'Antonio Guterres');
    assert.equal(related.length, 2);
    assert.deepEqual(related.map((e) => e.id).sort(), ['evt-1', 'evt-2']);
  });

  it('returns empty array for unknown entity', () => {
    const related = getRelatedEvents(EVENTS, 'Unknown Person');
    assert.deepEqual(related, []);
  });

  it('matches entity names case-insensitively', () => {
    const related = getRelatedEvents(EVENTS, 'antonio guterres');
    assert.equal(related.length, 2);
  });

  it('handles null events', () => {
    const related = getRelatedEvents(null, 'test');
    assert.deepEqual(related, []);
  });

  it('disambiguates same-name entities by type', () => {
    const crossTypeEvents = [
      {
        id: 'evt-org',
        entities: {
          people: [],
          organizations: [{ name: 'Georgia', mentionCount: 1 }],
          locations: [],
        },
      },
      {
        id: 'evt-loc',
        entities: {
          people: [],
          organizations: [],
          locations: [{ name: 'Georgia', mentionCount: 1 }],
        },
      },
      {
        id: 'evt-both',
        entities: {
          people: [],
          organizations: [{ name: 'Georgia', mentionCount: 1 }],
          locations: [{ name: 'Georgia', mentionCount: 1 }],
        },
      },
    ];
    // Without type → matches all
    const allGeorgia = getRelatedEvents(crossTypeEvents, 'Georgia');
    assert.equal(allGeorgia.length, 3, 'without type matches all events');
    // With type=organization → only org events
    const orgGeorgia = getRelatedEvents(crossTypeEvents, 'Georgia', 'organization');
    assert.equal(orgGeorgia.length, 2);
    assert.deepEqual(orgGeorgia.map((e) => e.id).sort(), ['evt-both', 'evt-org']);
    // With type=location → only location events
    const locGeorgia = getRelatedEvents(crossTypeEvents, 'Georgia', 'location');
    assert.equal(locGeorgia.length, 2);
    assert.deepEqual(locGeorgia.map((e) => e.id).sort(), ['evt-both', 'evt-loc']);
  });
});

describe('entityKey', () => {
  it('builds a typed key from type and name', () => {
    assert.equal(entityKey('person', 'John Smith'), 'person:john smith');
    assert.equal(entityKey('organization', 'NATO'), 'organization:nato');
    assert.equal(entityKey('location', 'Ukraine'), 'location:ukraine');
  });

  it('normalizes case', () => {
    assert.equal(entityKey('person', 'JOHN'), entityKey('person', 'john'));
  });
});

/* ── findShortestPath ── */

describe('findShortestPath', () => {
  // Build a simple graph: A—B—C—D, plus A—C (shortcut)
  const SAMPLE_EDGES = [
    { source: 'person:a', target: 'person:b', weight: 1 },
    { source: 'person:b', target: 'person:c', weight: 1 },
    { source: 'person:c', target: 'person:d', weight: 1 },
    { source: 'person:a', target: 'person:c', weight: 2 }, // shortcut A-C
    { source: 'org:x', target: 'loc:y', weight: 1 },        // disconnected component
  ];

  it('returns single-node path when source equals target', () => {
    const path = findShortestPath('person:a', 'person:a', SAMPLE_EDGES);
    assert.deepEqual(path, ['person:a']);
  });

  it('finds shortest path (takes the shortcut)', () => {
    // A→D: going A→B→C→D is 3 hops, A→C→D is 2 hops — should take shortcut
    const path = findShortestPath('person:a', 'person:d', SAMPLE_EDGES);
    assert.equal(path.length, 3); // A → C → D
    assert.equal(path[0], 'person:a');
    assert.equal(path[path.length - 1], 'person:d');
  });

  it('finds path between directly connected nodes', () => {
    const path = findShortestPath('person:a', 'person:b', SAMPLE_EDGES);
    assert.deepEqual(path, ['person:a', 'person:b']);
  });

  it('returns null when no path exists', () => {
    // 'person:a' and 'org:x' are in disconnected components
    const path = findShortestPath('person:a', 'org:x', SAMPLE_EDGES);
    assert.equal(path, null);
  });

  it('returns null when source node does not exist in edges', () => {
    const path = findShortestPath('person:ghost', 'person:a', SAMPLE_EDGES);
    assert.equal(path, null);
  });

  it('returns null when target node does not exist in edges', () => {
    const path = findShortestPath('person:a', 'person:ghost', SAMPLE_EDGES);
    assert.equal(path, null);
  });

  it('handles empty edges array', () => {
    const path = findShortestPath('person:a', 'person:b', []);
    assert.equal(path, null);
  });

  it('handles null/undefined edges', () => {
    assert.equal(findShortestPath('person:a', 'person:b', null), null);
    assert.equal(findShortestPath('person:a', 'person:b', undefined), null);
  });

  it('finds path through real entity graph data', () => {
    const graph = extractEntityGraph(EVENTS);
    const guterresId = entityKey('person', 'Antonio Guterres');
    const ukraineId = entityKey('location', 'Ukraine');
    const path = findShortestPath(guterresId, ukraineId, graph.edges);
    assert.ok(path !== null, 'should find a path between Guterres and Ukraine');
    assert.equal(path[0], guterresId);
    assert.equal(path[path.length - 1], ukraineId);
  });

  it('finds path between disconnected entity in full graph', () => {
    const graph = extractEntityGraph(EVENTS);
    const genevaId = entityKey('location', 'Geneva');
    const natoId = entityKey('organization', 'NATO');
    const path = findShortestPath(genevaId, natoId, graph.edges);
    // Geneva (evt-4) has no co-occurring entities → disconnected
    assert.equal(path, null);
  });
});

/* ── searchEntitiesByName ── */

describe('searchEntitiesByName', () => {
  const SAMPLE_NODES = [
    { id: 'person:antonio guterres', name: 'Antonio Guterres', type: 'person', mentionCount: 3 },
    { id: 'organization:united nations', name: 'United Nations', type: 'organization', mentionCount: 4 },
    { id: 'location:ukraine', name: 'Ukraine', type: 'location', mentionCount: 3 },
    { id: 'organization:nato', name: 'NATO', type: 'organization', mentionCount: 2 },
    { id: 'person:jens stoltenberg', name: 'Jens Stoltenberg', type: 'person', mentionCount: 1 },
    { id: 'location:syria', name: 'Syria', type: 'location', mentionCount: 2 },
  ];

  it('returns all nodes for empty query', () => {
    const result = searchEntitiesByName(SAMPLE_NODES, '');
    assert.equal(result.length, SAMPLE_NODES.length);
  });

  it('searches by partial name substring (case-insensitive)', () => {
    const result = searchEntitiesByName(SAMPLE_NODES, 'united');
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'United Nations');
  });

  it('matches case-insensitively', () => {
    const r1 = searchEntitiesByName(SAMPLE_NODES, 'NATO');
    const r2 = searchEntitiesByName(SAMPLE_NODES, 'nato');
    assert.equal(r1.length, r2.length);
    assert.equal(r1[0].name, 'NATO');
  });

  it('returns empty array when no match', () => {
    const result = searchEntitiesByName(SAMPLE_NODES, 'zzznotfound');
    assert.deepEqual(result, []);
  });

  it('handles null/undefined nodes array', () => {
    assert.deepEqual(searchEntitiesByName(null, 'test'), []);
    assert.deepEqual(searchEntitiesByName(undefined, 'test'), []);
  });

  it('trims whitespace in query', () => {
    const result = searchEntitiesByName(SAMPLE_NODES, '  ukraine  ');
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'Ukraine');
  });
});

/* ── EntityExplorerPage structure tests ── */

describe('EntityExplorerPage structure', () => {
  const path = 'src/pages/EntityExplorerPage.jsx';
  const source = fs.readFileSync(path, 'utf-8');

  it('file exists', () => {
    assert.ok(fs.existsSync(path), 'EntityExplorerPage.jsx should exist');
  });

  it('has search input with entity-search-input class', () => {
    assert.ok(source.includes('entity-search-input'), 'should have entity search input');
  });

  it('has type filter chips for PER/ORG/LOC', () => {
    assert.ok(source.includes('entity-type-chip'), 'should have type filter chips');
    assert.ok(source.includes('toggleTypeFilter'), 'should have toggle function');
    assert.ok(source.includes("'people'"), 'should filter by people');
    assert.ok(source.includes("'organizations'"), 'should filter by organizations');
    assert.ok(source.includes("'locations'"), 'should filter by locations');
  });

  it('imports filterGraphByType from entityGraph', () => {
    assert.ok(source.includes('filterGraphByType'), 'should import filterGraphByType');
  });

  it('imports findShortestPath from entityGraph', () => {
    assert.ok(source.includes('findShortestPath'), 'should import findShortestPath');
  });

  it('imports searchEntitiesByName from entityGraph', () => {
    assert.ok(source.includes('searchEntitiesByName'), 'should import searchEntitiesByName');
  });

  it('handles Shift+click for second entity selection', () => {
    assert.ok(source.includes('isShiftClick'), 'should check for Shift key on select');
    assert.ok(source.includes('selectedB'), 'should have second entity state');
  });

  it('computes shortest path between two selected entities', () => {
    assert.ok(source.includes('shortestPath'), 'should compute shortestPath');
    assert.ok(source.includes('findShortestPath('), 'should call findShortestPath');
  });

  it('shows full mention history label', () => {
    assert.ok(source.includes('mentionHistory'), 'should have mention history section');
    assert.ok(source.includes('allRelatedEvents'), 'should compute allRelatedEvents');
  });

  it('has Show on Map button with navigation', () => {
    assert.ok(source.includes('setEntityFilter'), 'should set entity filter');
    assert.ok(source.includes("navigate('/')"), 'should navigate to map');
  });

  it('passes pathHighlight prop to EntityRelationshipGraph', () => {
    assert.ok(source.includes('pathHighlight'), 'should pass pathHighlight prop');
  });
});

/* ── EntityRelationshipGraph structure tests ── */

describe('EntityRelationshipGraph structure', () => {
  const path = 'src/components/EntityRelationshipGraph.jsx';
  const source = fs.readFileSync(path, 'utf-8');

  it('file exists', () => {
    assert.ok(fs.existsSync(path), 'EntityRelationshipGraph.jsx should exist');
  });

  it('accepts selectedEntityB prop for second selection', () => {
    assert.ok(source.includes('selectedEntityB'), 'should accept selectedEntityB prop');
  });

  it('accepts pathHighlight prop for path array', () => {
    assert.ok(source.includes('pathHighlight'), 'should accept pathHighlight prop');
  });

  it('renders edge width based on weight for co-occurrence strength', () => {
    assert.ok(source.includes('weightRatio'), 'should compute weight ratio');
    assert.ok(source.includes('maxEdgeWeight'), 'should compute max edge weight');
  });

  it('uses cyan color for path edges and nodes', () => {
    assert.ok(source.includes('rgba(94, 199, 212'), 'should use cyan for path highlights');
  });

  it('supports Shift+click on nodes via onEntitySelect callback', () => {
    assert.ok(source.includes('shiftKey'), 'should check shiftKey in pointer events');
  });
});
