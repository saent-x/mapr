import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getRelatedEvents } from '../src/utils/entityGraph.js';

/**
 * Entity-map integration tests — verify that entity filtering works
 * correctly to bridge the entity explorer with the map view.
 */

// ── filterStore entity filter ────────────────────────────────────────────────

describe('filterStore entity filter', async () => {
  const { default: useFilterStore } = await import('../src/stores/filterStore.js');

  const DEFAULTS = {
    searchQuery: '',
    debouncedSearch: '',
    dateWindow: '168h',
    minSeverity: 0,
    minConfidence: 0,
    sortMode: 'severity',
    mapOverlay: 'severity',
    verificationFilter: 'all',
    sourceTypeFilter: 'all',
    languageFilter: 'all',
    accuracyMode: 'standard',
    precisionFilter: 'all',
    hideAmplified: false,
    entityFilter: null,
  };

  beforeEach(() => {
    useFilterStore.setState(DEFAULTS);
  });

  it('entityFilter defaults to null', () => {
    assert.equal(useFilterStore.getState().entityFilter, null);
  });

  it('setEntityFilter sets the entity filter', () => {
    useFilterStore.getState().setEntityFilter({
      id: 'person:john doe',
      name: 'John Doe',
      type: 'person',
    });
    const filter = useFilterStore.getState().entityFilter;
    assert.deepEqual(filter, {
      id: 'person:john doe',
      name: 'John Doe',
      type: 'person',
    });
  });

  it('clearEntityFilter resets entity filter to null', () => {
    useFilterStore.getState().setEntityFilter({
      id: 'organization:nato',
      name: 'NATO',
      type: 'organization',
    });
    assert.ok(useFilterStore.getState().entityFilter !== null);
    useFilterStore.getState().clearEntityFilter();
    assert.equal(useFilterStore.getState().entityFilter, null);
  });

  it('setEntityFilter replaces previous entity filter', () => {
    useFilterStore.getState().setEntityFilter({
      id: 'person:alice',
      name: 'Alice',
      type: 'person',
    });
    useFilterStore.getState().setEntityFilter({
      id: 'location:paris',
      name: 'Paris',
      type: 'location',
    });
    const filter = useFilterStore.getState().entityFilter;
    assert.equal(filter.name, 'Paris');
    assert.equal(filter.type, 'location');
  });
});

// ── Entity filter applied to events ──────────────────────────────────────────

describe('entity filter applied to events', () => {
  const mockEvents = [
    {
      id: 'evt-1',
      title: 'NATO summit in Brussels',
      severity: 70,
      entities: {
        people: [],
        organizations: [{ name: 'NATO', mentionCount: 3 }],
        locations: [{ name: 'Brussels', mentionCount: 1 }],
      },
    },
    {
      id: 'evt-2',
      title: 'UN meeting in Geneva',
      severity: 50,
      entities: {
        people: [{ name: 'Antonio Guterres', mentionCount: 2 }],
        organizations: [{ name: 'United Nations', mentionCount: 1 }],
        locations: [{ name: 'Geneva', mentionCount: 1 }],
      },
    },
    {
      id: 'evt-3',
      title: 'NATO exercises in Baltic region',
      severity: 65,
      entities: {
        people: [],
        organizations: [{ name: 'NATO', mentionCount: 2 }],
        locations: [{ name: 'Baltic', mentionCount: 1 }],
      },
    },
    {
      id: 'evt-4',
      title: 'Earthquake in Japan',
      severity: 80,
      entities: {
        people: [],
        organizations: [],
        locations: [{ name: 'Japan', mentionCount: 1 }],
      },
    },
  ];

  it('getRelatedEvents filters events by entity name and type', () => {
    const natoEvents = getRelatedEvents(mockEvents, 'NATO', 'organization');
    assert.equal(natoEvents.length, 2);
    assert.ok(natoEvents.some((e) => e.id === 'evt-1'));
    assert.ok(natoEvents.some((e) => e.id === 'evt-3'));
  });

  it('entity filter produces correct event id set for map filtering', () => {
    const entityFilter = { id: 'organization:nato', name: 'NATO', type: 'organization' };
    const entityEvents = new Set(
      getRelatedEvents(mockEvents, entityFilter.name, entityFilter.type).map((e) => e.id)
    );
    const filtered = mockEvents.filter((s) => entityEvents.has(s.id));
    assert.equal(filtered.length, 2);
    assert.ok(filtered.every((e) => e.id === 'evt-1' || e.id === 'evt-3'));
  });

  it('entity filter with no matching events produces empty result', () => {
    const entityFilter = { id: 'person:nobody', name: 'Nobody', type: 'person' };
    const entityEvents = new Set(
      getRelatedEvents(mockEvents, entityFilter.name, entityFilter.type).map((e) => e.id)
    );
    const filtered = mockEvents.filter((s) => entityEvents.has(s.id));
    assert.equal(filtered.length, 0);
  });

  it('null entity filter does not restrict events', () => {
    const entityFilter = null;
    let filtered = mockEvents;
    if (entityFilter) {
      const entityEvents = new Set(
        getRelatedEvents(filtered, entityFilter.name, entityFilter.type).map((e) => e.id)
      );
      filtered = filtered.filter((s) => entityEvents.has(s.id));
    }
    assert.equal(filtered.length, 4, 'all events should be included when entity filter is null');
  });

  it('entity filter by location type only matches location entities', () => {
    const entityFilter = { id: 'location:brussels', name: 'Brussels', type: 'location' };
    const entityEvents = new Set(
      getRelatedEvents(mockEvents, entityFilter.name, entityFilter.type).map((e) => e.id)
    );
    const filtered = mockEvents.filter((s) => entityEvents.has(s.id));
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'evt-1');
  });

  it('entity filter by person type only matches people entities', () => {
    const entityFilter = { id: 'person:antonio guterres', name: 'Antonio Guterres', type: 'person' };
    const entityEvents = new Set(
      getRelatedEvents(mockEvents, entityFilter.name, entityFilter.type).map((e) => e.id)
    );
    const filtered = mockEvents.filter((s) => entityEvents.has(s.id));
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'evt-2');
  });
});
