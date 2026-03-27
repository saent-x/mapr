/**
 * Entity graph utilities — extract entity nodes and co-occurrence edges
 * from event data for the entity relationship visualization.
 *
 * Shared between frontend components and tests.
 */

/**
 * Extract a graph of entity nodes and co-occurrence edges from events.
 *
 * Each unique entity becomes a node with:
 *  - name, type (person|organization|location), mentionCount, eventIds
 *
 * Entities that co-occur in the same event are connected by edges with:
 *  - source, target, weight (number of shared events), sharedEventIds
 *
 * @param {Array|null} events - Array of event objects from the backend
 * @param {{ maxNodes?: number }} options - Optional limits for performance
 * @returns {{ nodes: Array, edges: Array }}
 */
export function extractEntityGraph(events, { maxNodes = 0 } = {}) {
  if (!events || !Array.isArray(events)) {
    return { nodes: [], edges: [] };
  }

  // Accumulate unique entities keyed by lowercase name
  const entityMap = new Map(); // key → { name, type, mentionCount, eventIds }

  // Track co-occurrences: "nameA|nameB" → { source, target, weight, sharedEventIds }
  const edgeMap = new Map();

  for (const event of events) {
    if (!event.entities) continue;

    const { people = [], organizations = [], locations = [] } = event.entities;

    // Collect all entities from this event
    const eventEntities = [];

    for (const p of people) {
      if (!p.name) continue;
      const key = p.name.toLowerCase();
      const existing = entityMap.get(key);
      if (existing) {
        existing.mentionCount += p.mentionCount || 1;
        if (!existing.eventIds.includes(event.id)) {
          existing.eventIds.push(event.id);
        }
      } else {
        entityMap.set(key, {
          name: p.name,
          type: 'person',
          mentionCount: p.mentionCount || 1,
          eventIds: [event.id],
        });
      }
      eventEntities.push(key);
    }

    for (const o of organizations) {
      if (!o.name) continue;
      const key = o.name.toLowerCase();
      const existing = entityMap.get(key);
      if (existing) {
        existing.mentionCount += o.mentionCount || 1;
        if (!existing.eventIds.includes(event.id)) {
          existing.eventIds.push(event.id);
        }
      } else {
        entityMap.set(key, {
          name: o.name,
          type: 'organization',
          mentionCount: o.mentionCount || 1,
          eventIds: [event.id],
        });
      }
      eventEntities.push(key);
    }

    for (const l of locations) {
      if (!l.name) continue;
      const key = l.name.toLowerCase();
      const existing = entityMap.get(key);
      if (existing) {
        existing.mentionCount += l.mentionCount || 1;
        if (!existing.eventIds.includes(event.id)) {
          existing.eventIds.push(event.id);
        }
      } else {
        entityMap.set(key, {
          name: l.name,
          type: 'location',
          mentionCount: l.mentionCount || 1,
          eventIds: [event.id],
        });
      }
      eventEntities.push(key);
    }

    // Build edges for co-occurring entities in this event
    const unique = [...new Set(eventEntities)];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const [a, b] = [unique[i], unique[j]].sort();
        const edgeKey = `${a}|${b}`;
        const existing = edgeMap.get(edgeKey);
        if (existing) {
          existing.weight += 1;
          if (!existing.sharedEventIds.includes(event.id)) {
            existing.sharedEventIds.push(event.id);
          }
        } else {
          const nodeA = entityMap.get(a);
          const nodeB = entityMap.get(b);
          edgeMap.set(edgeKey, {
            source: nodeA.name,
            target: nodeB.name,
            weight: 1,
            sharedEventIds: [event.id],
          });
        }
      }
    }
  }

  let nodes = [...entityMap.values()];
  let edges = [...edgeMap.values()];

  // Prune to top-N nodes by mention count for performance with large datasets
  if (maxNodes > 0 && nodes.length > maxNodes) {
    nodes.sort((a, b) => b.mentionCount - a.mentionCount);
    nodes = nodes.slice(0, maxNodes);
    const kept = new Set(nodes.map((n) => n.name));
    edges = edges.filter((e) => kept.has(e.source) && kept.has(e.target));
  }

  return { nodes, edges };
}

/**
 * Filter a graph to include only nodes matching the enabled entity types.
 * Edges are kept only if both endpoints are in the filtered node set.
 *
 * @param {{ nodes: Array, edges: Array }} graph
 * @param {{ people: boolean, organizations: boolean, locations: boolean }} typeFilter
 * @returns {{ nodes: Array, edges: Array }}
 */
export function filterGraphByType(graph, typeFilter) {
  const typeMap = {
    person: typeFilter.people,
    organization: typeFilter.organizations,
    location: typeFilter.locations,
  };

  const filteredNodes = graph.nodes.filter((n) => typeMap[n.type]);
  const nodeNames = new Set(filteredNodes.map((n) => n.name));
  const filteredEdges = graph.edges.filter(
    (e) => nodeNames.has(e.source) && nodeNames.has(e.target)
  );

  return { nodes: filteredNodes, edges: filteredEdges };
}

/**
 * Get all events that reference a given entity name (case-insensitive).
 *
 * @param {Array|null} events - Array of event objects
 * @param {string} entityName - Entity name to look up
 * @returns {Array} - Matching events
 */
export function getRelatedEvents(events, entityName) {
  if (!events || !Array.isArray(events) || !entityName) return [];

  const lower = entityName.toLowerCase();

  return events.filter((event) => {
    if (!event.entities) return false;
    const { people = [], organizations = [], locations = [] } = event.entities;
    return (
      people.some((p) => p.name && p.name.toLowerCase() === lower) ||
      organizations.some((o) => o.name && o.name.toLowerCase() === lower) ||
      locations.some((l) => l.name && l.name.toLowerCase() === lower)
    );
  });
}
