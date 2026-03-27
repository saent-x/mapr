import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Store tests — verify Zustand store logic for filterStore and uiStore.
 *
 * We import the stores and interact with them via getState()/setState(),
 * which works outside React. Each test resets the store to defaults.
 */

// ── filterStore ──────────────────────────────────────────────────────────────

describe('filterStore', async () => {
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
  };

  beforeEach(() => {
    useFilterStore.setState(DEFAULTS);
  });

  it('initializes with default filter values', () => {
    const state = useFilterStore.getState();
    assert.equal(state.minSeverity, 0);
    assert.equal(state.sortMode, 'severity');
    assert.equal(state.dateWindow, '168h');
    assert.equal(state.hideAmplified, false);
  });

  it('setMinSeverity updates severity threshold', () => {
    useFilterStore.getState().setMinSeverity(50);
    assert.equal(useFilterStore.getState().minSeverity, 50);
  });

  it('setSortMode updates sort mode', () => {
    useFilterStore.getState().setSortMode('latest');
    assert.equal(useFilterStore.getState().sortMode, 'latest');
  });

  it('setSearchQuery updates searchQuery immediately', () => {
    useFilterStore.getState().setSearchQuery('earthquake');
    assert.equal(useFilterStore.getState().searchQuery, 'earthquake');
  });

  it('getFilterParams returns current filter values as object', () => {
    useFilterStore.getState().setMinSeverity(25);
    useFilterStore.getState().setAccuracyMode('strict');
    const params = useFilterStore.getState().getFilterParams();
    assert.equal(params.minSeverity, 25);
    assert.equal(params.accuracyMode, 'strict');
    assert.equal(params.verificationFilter, 'all');
    assert.ok(params.dateFloor, 'dateFloor should be computed');
  });

  it('applyView updates filter state from a saved view', () => {
    useFilterStore.getState().applyView({
      filters: { minSeverity: 60, sortMode: 'latest', dateWindow: '24h' },
      mapState: { mapOverlay: 'coverage' },
    });
    const s = useFilterStore.getState();
    assert.equal(s.minSeverity, 60);
    assert.equal(s.sortMode, 'latest');
    assert.equal(s.dateWindow, '24h');
    assert.equal(s.mapOverlay, 'coverage');
  });

  it('applyView does not overwrite fields not present in the view', () => {
    useFilterStore.getState().setHideAmplified(true);
    useFilterStore.getState().applyView({ filters: { minSeverity: 10 }, mapState: {} });
    assert.equal(useFilterStore.getState().minSeverity, 10);
    assert.equal(useFilterStore.getState().hideAmplified, true);
  });
});

// ── uiStore ──────────────────────────────────────────────────────────────────

describe('uiStore', async () => {
  const { default: useUIStore } = await import('../src/stores/uiStore.js');

  const DEFAULTS = {
    mapMode: 'globe',
    drawerMode: null,
    selectedRegion: null,
    selectedStoryId: null,
    selectedArc: null,
    showExport: false,
    scrubTime: null,
    toasts: [],
    activeViewId: null,
  };

  beforeEach(() => {
    useUIStore.setState(DEFAULTS);
  });

  it('selectRegion toggles region on/off', () => {
    useUIStore.getState().selectRegion('US');
    assert.equal(useUIStore.getState().selectedRegion, 'US');

    useUIStore.getState().selectRegion('US');
    assert.equal(useUIStore.getState().selectedRegion, null);
  });

  it('selectRegion clears story and arc', () => {
    useUIStore.setState({ selectedStoryId: 'story-1', selectedArc: { id: 'arc-1' } });
    useUIStore.getState().selectRegion('FR');
    assert.equal(useUIStore.getState().selectedStoryId, null);
    assert.equal(useUIStore.getState().selectedArc, null);
    assert.equal(useUIStore.getState().selectedRegion, 'FR');
  });

  it('selectStory sets story id and region', () => {
    useUIStore.getState().selectStory({ id: 'story-42', isoA2: 'DE' });
    assert.equal(useUIStore.getState().selectedStoryId, 'story-42');
    assert.equal(useUIStore.getState().selectedRegion, 'DE');
    assert.equal(useUIStore.getState().selectedArc, null);
  });

  it('closePanel clears all selections', () => {
    useUIStore.setState({ selectedRegion: 'JP', selectedStoryId: 's-1', selectedArc: {} });
    useUIStore.getState().closePanel();
    assert.equal(useUIStore.getState().selectedRegion, null);
    assert.equal(useUIStore.getState().selectedStoryId, null);
    assert.equal(useUIStore.getState().selectedArc, null);
  });

  it('toggleMapMode switches between globe and flat', () => {
    useUIStore.setState({ mapMode: 'globe' });
    useUIStore.getState().toggleMapMode();
    assert.equal(useUIStore.getState().mapMode, 'flat');
    useUIStore.getState().toggleMapMode();
    assert.equal(useUIStore.getState().mapMode, 'globe');
  });

  it('toggleDrawer opens/closes drawer mode', () => {
    useUIStore.getState().toggleDrawer('filters');
    assert.equal(useUIStore.getState().drawerMode, 'filters');
    useUIStore.getState().toggleDrawer('filters');
    assert.equal(useUIStore.getState().drawerMode, null);
  });

  it('addToast appends a toast entry', () => {
    useUIStore.getState().addToast('test message', 'info');
    const toasts = useUIStore.getState().toasts;
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].message, 'test message');
    assert.equal(toasts[0].type, 'info');
  });

  it('handleSearchSelect sets region for region result', () => {
    useUIStore.getState().handleSearchSelect({ type: 'region', iso: 'NG' });
    assert.equal(useUIStore.getState().selectedRegion, 'NG');
    assert.equal(useUIStore.getState().selectedStoryId, null);
  });

  it('handleSearchSelect sets story for story result', () => {
    useUIStore.getState().handleSearchSelect({ type: 'story', story: { id: 's-5', isoA2: 'BR' } });
    assert.equal(useUIStore.getState().selectedStoryId, 's-5');
    assert.equal(useUIStore.getState().selectedRegion, 'BR');
  });
});
