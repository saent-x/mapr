function passesAccuracyMode(story, accuracyMode) {
  if (accuracyMode !== 'strict') {
    return true;
  }

  const precision = story.geocodePrecision || 'unknown';
  const hasWarnings = (story.confidenceReasons || []).some((reason) => reason.tone === 'warning');

  if (precision === 'unknown') {
    return false;
  }

  if ((story.confidence || 0) < 65) {
    return false;
  }

  if (hasWarnings) {
    return false;
  }

  return true;
}

export function storyMatchesFilters(story, filters) {
  const {
    minSeverity = 0,
    minConfidence = 0,
    dateFloor = null,
    accuracyMode = 'standard',
    verificationFilter = 'all',
    sourceTypeFilter = 'all',
    languageFilter = 'all',
    precisionFilter = 'all'
  } = filters;

  if ((story.severity || 0) < minSeverity) {
    return false;
  }

  if ((story.confidence || 0) < minConfidence) {
    return false;
  }

  if (!passesAccuracyMode(story, accuracyMode)) {
    return false;
  }

  if (dateFloor && new Date(story.publishedAt) < dateFloor) {
    return false;
  }

  if (verificationFilter !== 'all' && story.verificationStatus !== verificationFilter) {
    return false;
  }

  if (sourceTypeFilter !== 'all' && !(story.sourceTypes || [story.sourceType]).includes(sourceTypeFilter)) {
    return false;
  }

  if (languageFilter !== 'all' && !(story.languages || [story.language]).includes(languageFilter)) {
    return false;
  }

  if (precisionFilter !== 'all' && (story.geocodePrecision || 'unknown') !== precisionFilter) {
    return false;
  }

  return true;
}

export function sortStories(stories, sortMode) {
  return [...stories].sort((left, right) => {
    if (sortMode === 'latest') {
      return new Date(right.publishedAt) - new Date(left.publishedAt);
    }

    return (
      (right.severity || 0) - (left.severity || 0) ||
      new Date(right.publishedAt) - new Date(left.publishedAt)
    );
  });
}
