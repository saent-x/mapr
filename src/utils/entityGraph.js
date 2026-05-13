/**
 * Entity graph utilities — extract entity nodes and co-occurrence edges
 * from event data for the entity relationship visualization.
 *
 * Shared between frontend components and tests.
 */

/**
 * Build a typed entity key from type and name.
 * This ensures entities with the same name but different types
 * (e.g. "Georgia" the org vs "Georgia" the location) stay separate.
 *
 * @param {string} type - Entity type (person|organization|location)
 * @param {string} name - Entity name
 * @returns {string} Typed key like "location:georgia"
 */
export function entityKey(type, name) {
  return `${type}:${name.toLowerCase()}`;
}

/**
 * Extract a graph of entity nodes and co-occurrence edges from events.
 *
 * Each unique entity becomes a node with:
 *  - id (typed key), name, type (person|organization|location), mentionCount, eventIds
 *
 * Entities that co-occur in the same event are connected by edges with:
 *  - source, target (typed keys), weight (number of shared events), sharedEventIds
 *
 * @param {Array|null} events - Array of event objects from the backend
 * @param {{ maxNodes?: number }} options - Optional limits for performance
 * @returns {{ nodes: Array, edges: Array }}
 */
export function extractEntityGraph(events, { maxNodes = 0, maxEdgesPerNode = 0, minEdgeWeight = 1 } = {}) {
  if (!events || !Array.isArray(events)) {
    return { nodes: [], edges: [] };
  }

  // Accumulate unique entities keyed by type:lowercase_name
  const entityMap = new Map(); // key → { id, name, type, mentionCount, eventIds }

  // Track co-occurrences: "keyA|keyB" → { source, target, weight, sharedEventIds }
  const edgeMap = new Map();

  for (const event of events) {
    if (!event.entities) continue;

    const { people = [], organizations = [], locations = [] } = event.entities;

    // Collect all entity keys from this event
    const eventEntities = [];

    for (const p of people) {
      if (!p.name) continue;
      const key = entityKey('person', p.name);
      const existing = entityMap.get(key);
      if (existing) {
        existing.mentionCount += p.mentionCount || 1;
        if (!existing.eventIds.includes(event.id)) {
          existing.eventIds.push(event.id);
        }
      } else {
        entityMap.set(key, {
          id: key,
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
      const key = entityKey('organization', o.name);
      const existing = entityMap.get(key);
      if (existing) {
        existing.mentionCount += o.mentionCount || 1;
        if (!existing.eventIds.includes(event.id)) {
          existing.eventIds.push(event.id);
        }
      } else {
        entityMap.set(key, {
          id: key,
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
      const key = entityKey('location', l.name);
      const existing = entityMap.get(key);
      if (existing) {
        existing.mentionCount += l.mentionCount || 1;
        if (!existing.eventIds.includes(event.id)) {
          existing.eventIds.push(event.id);
        }
      } else {
        entityMap.set(key, {
          id: key,
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
          edgeMap.set(edgeKey, {
            source: a,
            target: b,
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
    const kept = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => kept.has(e.source) && kept.has(e.target));
  }

  // Drop weak co-occurrences (weight=1 edges are noise — one shared event)
  if (minEdgeWeight > 1) {
    edges = edges.filter((e) => (e.weight || 1) >= minEdgeWeight);
  }

  // Sparsify: keep each node's top-K strongest edges. Heavy edges tend to
  // be kept anyway because they appear in the top-K of both endpoints.
  if (maxEdgesPerNode > 0 && edges.length > 0) {
    const byNode = new Map();
    for (const e of edges) {
      if (!byNode.has(e.source)) byNode.set(e.source, []);
      if (!byNode.has(e.target)) byNode.set(e.target, []);
      byNode.get(e.source).push(e);
      byNode.get(e.target).push(e);
    }
    const keep = new Set();
    for (const list of byNode.values()) {
      list.sort((a, b) => (b.weight || 0) - (a.weight || 0));
      for (let i = 0; i < Math.min(maxEdgesPerNode, list.length); i++) {
        keep.add(list[i]);
      }
    }
    edges = edges.filter((e) => keep.has(e));
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
  const nodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = graph.edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  return { nodes: filteredNodes, edges: filteredEdges };
}

/**
 * Get all events that reference a given entity (case-insensitive).
 *
 * When entityType is provided, only matches entities of that type,
 * disambiguating e.g. "Georgia" (organization) from "Georgia" (location).
 *
 * @param {Array|null} events - Array of event objects
 * @param {string} entityName - Entity name to look up
 * @param {string} [entityType] - Optional entity type (person|organization|location)
 * @returns {Array} - Matching events
 */
export function getRelatedEvents(events, entityName, entityType) {
  if (!events || !Array.isArray(events) || !entityName) return [];

  const lower = entityName.toLowerCase();

  return events.filter((event) => {
    if (!event.entities) return false;
    const { people = [], organizations = [], locations = [] } = event.entities;

    if (entityType) {
      // Type-specific lookup for disambiguation
      switch (entityType) {
        case 'person':
          return people.some((p) => p.name && p.name.toLowerCase() === lower);
        case 'organization':
          return organizations.some((o) => o.name && o.name.toLowerCase() === lower);
        case 'location':
          return locations.some((l) => l.name && l.name.toLowerCase() === lower);
        default:
          return false;
      }
    }

    // No type specified — search all entity lists (backward compatible)
    return (
      people.some((p) => p.name && p.name.toLowerCase() === lower) ||
      organizations.some((o) => o.name && o.name.toLowerCase() === lower) ||
      locations.some((l) => l.name && l.name.toLowerCase() === lower)
    );
  });
}

/**
 * Find the shortest path between two entities in the co-occurrence graph
 * using breadth-first search (BFS).
 *
 * Returns an ordered array of typed entity keys forming the path from
 * sourceId to targetId (inclusive on both ends), or null if no path exists.
 *
 * @param {string} sourceId - Typed entity key of the starting node
 * @param {string} targetId - Typed entity key of the target node
 * @param {Array} edges - Array of edge objects with source/target typed keys
 * @returns {Array<string>|null} - Ordered path array or null if no path
 */
export function findShortestPath(sourceId, targetId, edges) {
  if (sourceId === targetId) return [sourceId];
  if (!edges || edges.length === 0) return null;

  // Build adjacency list
  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
    adjacency.get(edge.source).push(edge.target);
    adjacency.get(edge.target).push(edge.source);
  }

  if (!adjacency.has(sourceId) || !adjacency.has(targetId)) return null;

  // BFS
  const visited = new Set([sourceId]);
  const parent = new Map();
  const queue = [sourceId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === targetId) {
      // Reconstruct path
      const path = [];
      let node = targetId;
      while (node !== undefined) {
        path.unshift(node);
        node = parent.get(node);
      }
      return path;
    }
    for (const neighbor of adjacency.get(current) || []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }

  return null; // No path found
}

/**
 * Search/filter entities by name substring (case-insensitive).
 * Returns nodes whose name contains the search query.
 *
 * @param {Array} nodes - Array of entity node objects
 * @param {string} query - Search query string
 * @returns {Array} - Filtered nodes
 */
export function searchEntitiesByName(nodes, query) {
  if (!nodes || !Array.isArray(nodes)) return [];
  if (!query || query.trim().length === 0) return nodes;
  const lower = query.toLowerCase().trim();
  return nodes.filter((n) => n.name && n.name.toLowerCase().includes(lower));
}
