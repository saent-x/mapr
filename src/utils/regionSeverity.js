export const calculateRegionSeverity = (newsList) => {
  const regions = {};

  newsList.forEach((story) => {
    if (!regions[story.isoA2]) {
      regions[story.isoA2] = {
        count: 0,
        totalSeverity: 0,
        averageSeverity: 0,
        peakSeverity: 0,
        latestStory: null,
        peakStory: null,
        region: story.region
      };
    }

    const r = regions[story.isoA2];
    r.count += 1;
    r.totalSeverity += story.severity;
    r.peakSeverity = Math.max(r.peakSeverity, story.severity);

    if (!r.latestStory || new Date(story.publishedAt) > new Date(r.latestStory.publishedAt)) {
      r.latestStory = story;
    }

    if (!r.peakStory || story.severity > r.peakStory.severity) {
      r.peakStory = story;
    }
  });

  Object.values(regions).forEach((r) => {
    r.averageSeverity = r.totalSeverity / r.count;
  });

  return regions;
};
