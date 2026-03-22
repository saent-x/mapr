export function generateLifecycleMessages(currentEvents, previousEvents) {
  const prevMap = new Map(previousEvents.map(e => [e.id, e]));
  const messages = [];
  for (const event of currentEvents) {
    const prev = prevMap.get(event.id);
    if (prev && prev.lifecycle !== event.lifecycle) {
      messages.push({
        text: `${event.title} → ${event.lifecycle}`,
        severity: event.severity,
        lifecycle: event.lifecycle
      });
    }
  }
  return messages;
}
