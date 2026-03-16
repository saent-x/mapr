export function mergeStoryLists(...lists) {
  const merged = new Map();

  lists.flat().forEach((story) => {
    if (story?.id && !merged.has(story.id)) {
      merged.set(story.id, story);
    }
  });

  return [...merged.values()];
}
