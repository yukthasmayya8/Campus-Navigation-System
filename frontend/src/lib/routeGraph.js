/**
 * Graph-based campus navigation engine.
 *
 * Recorded routes are polylines. This module converts them into a connected graph
 * (nodes = points/intersections, edges = walkable segments with distance) and runs
 * Dijkstra / Yen's K-shortest-paths on it. It also supports projecting an arbitrary
 * GPS position onto the nearest edge so navigation can start from an intermediate
 * point (not just a recorded building/endpoint).
 */

const EARTH_R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const hav = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
};

const NODE_MERGE_M = 6; // points within this distance become one node

/** Rebuild adjacency from the edge list. Used after any graph edit so callers never share a mutated graph. */
function rebuildAdj(graph) {
  graph.adj = new Map();
  for (const node of graph.nodes) graph.adj.set(node.id, []);
  for (const edge of graph.edges) {
    if (!graph.adj.has(edge.from)) graph.adj.set(edge.from, []);
    graph.adj.get(edge.from).push(edge);
  }
  return graph;
}

function cloneGraph(graph) {
  const copy = {
    nodes: graph.nodes.map((n) => ({ ...n })),
    edges: graph.edges.map((e) => ({ ...e, geometry: (e.geometry || []).map((p) => [...p]) })),
    adj: new Map(),
  };
  return rebuildAdj(copy);
}

export function buildGraph(routes = []) {
  const nodes = []; // {id, lat, lng}
  const edges = []; // {id, from, to, distance, geometry: [[lat,lng],...], routeId, bidirectional}
  const nodeIdByKey = new Map();

  function findOrCreateNode(lat, lng) {
    // find existing node within NODE_MERGE_M
    for (const n of nodes) {
      if (hav({ lat: n.lat, lng: n.lng }, { lat, lng }) <= NODE_MERGE_M) return n.id;
    }
    const id = nodes.length;
    nodes.push({ id, lat, lng });
    return id;
  }

  for (const route of routes) {
    if (!route || !Array.isArray(route.points) || route.points.length < 2) continue;
    const bidirectional = route.directionality !== 'one_way';
    const pts = route.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (![a.latitude, a.longitude, b.latitude, b.longitude].every(Number.isFinite)) continue;
      const from = findOrCreateNode(a.latitude, a.longitude);
      const to = findOrCreateNode(b.latitude, b.longitude);
      if (from === to) continue;
      const distance = hav({ lat: a.latitude, lng: a.longitude }, { lat: b.latitude, lng: b.longitude });
      edges.push({ id: edges.length, from, to, distance, geometry: [[a.latitude, a.longitude], [b.latitude, b.longitude]], routeId: route.routeId ?? null, bidirectional });
      if (bidirectional) {
        edges.push({ id: edges.length, from: to, to: from, distance, geometry: [[b.latitude, b.longitude], [a.latitude, a.longitude]], routeId: route.routeId ?? null, bidirectional });
      }
    }
  }

  // adjacency
  return rebuildAdj({ nodes, edges, adj: new Map() });
}

function dijkstra(graph, sourceId, destId) {
  const { nodes, adj } = graph;
  const dist = new Map(nodes.map((n) => [n.id, Infinity]));
  const prev = new Map();
  const visited = new Set();
  dist.set(sourceId, 0);
  // simple priority queue (array-based, fine for campus scale)
  const pq = [{ id: sourceId, d: 0 }];
  while (pq.length) {
    pq.sort((a, b) => a.d - b.d);
    const { id: u } = pq.shift();
    if (visited.has(u)) continue;
    visited.add(u);
    if (u === destId) break;
    for (const e of (adj.get(u) || [])) {
      const v = e.to;
      if (visited.has(v)) continue;
      const alt = dist.get(u) + e.distance;
      if (alt < dist.get(v)) {
        dist.set(v, alt);
        prev.set(v, { node: u, edge: e });
        pq.push({ id: v, d: alt });
      }
    }
  }
  if (!isFinite(dist.get(destId))) return null;
  // reconstruct
  const pathNodes = [];
  const pathEdges = [];
  let cur = destId;
  while (cur !== sourceId) {
    pathNodes.unshift(cur);
    const p = prev.get(cur);
    if (!p) return null;
    pathEdges.unshift(p.edge);
    cur = p.node;
  }
  pathNodes.unshift(sourceId);
  return { nodes: pathNodes, edges: pathEdges, distance: dist.get(destId) };
}

export function shortestPath(graph, sourceId, destId) {
  if (sourceId === destId) return { nodes: [sourceId], edges: [], distance: 0 };
  return dijkstra(graph, sourceId, destId);
}

export function projectPointToGraph(graph, lat, lng) {
  let best = null;
  for (const e of graph.edges) {
    const a = graph.nodes[e.from], b = graph.nodes[e.to];
    if (!a || !b) continue;
    // project (lat,lng) onto segment a-b
    const dLat = b.lat - a.lat, dLng = b.lng - a.lng;
    const len2 = dLat * dLat + dLng * dLng;
    let t = 0;
    if (len2 > 0) {
      t = ((lat - a.lat) * dLat + (lng - a.lng) * dLng) / len2;
      t = Math.max(0, Math.min(1, t));
    }
    const projLat = a.lat + t * dLat;
    const projLng = a.lng + t * dLng;
    const d = hav({ lat: projLat, lng: projLng }, { lat, lng });
    if (!best || d < best.distance) {
      best = { edge: e, t, projLat, projLng, distance: d, fromNode: e.from, toNode: e.to };
    }
  }
  return best;
}

export function routeFromPosition(graph, lat, lng, destId, maxSnapM = 40) {
  if (!graph || !Number.isFinite(lat) || !Number.isFinite(lng) || destId == null) return null;
  // Work on a copy: splitting an edge to insert a virtual start node must never
  // corrupt the shared graph used by later GPS fixes or reroute checks.
  const working = cloneGraph(graph);
  const proj = projectPointToGraph(working, lat, lng);
  if (!proj || proj.distance > maxSnapM) return null;

  const virtualId = working.nodes.length;
  working.nodes.push({ id: virtualId, lat: proj.projLat, lng: proj.projLng, virtual: true });
  const e = proj.edge;
  const a = working.nodes[e.from], b = working.nodes[e.to];
  if (!a || !b) return null;
  const d1 = hav({ lat: a.lat, lng: a.lng }, { lat: proj.projLat, lng: proj.projLng });
  const d2 = hav({ lat: proj.projLat, lng: proj.projLng }, { lat: b.lat, lng: b.lng });

  const toRemove = new Set([e.id]);
  for (const oe of working.edges) {
    if (oe.from === e.to && oe.to === e.from && oe.routeId === e.routeId) toRemove.add(oe.id);
  }
  working.edges = working.edges.filter((x) => !toRemove.has(x.id));
  rebuildAdj(working);

  const newEdges = [
    { id: working.edges.length, from: e.from, to: virtualId, distance: d1, geometry: [[a.lat, a.lng], [proj.projLat, proj.projLng]], routeId: e.routeId, bidirectional: e.bidirectional },
    { id: working.edges.length + 1, from: virtualId, to: e.to, distance: d2, geometry: [[proj.projLat, proj.projLng], [b.lat, b.lng]], routeId: e.routeId, bidirectional: e.bidirectional },
  ];
  if (e.bidirectional) {
    newEdges.push({ id: working.edges.length + 2, from: virtualId, to: e.from, distance: d1, geometry: [[proj.projLat, proj.projLng], [a.lat, a.lng]], routeId: e.routeId, bidirectional: true });
    newEdges.push({ id: working.edges.length + 3, from: e.to, to: virtualId, distance: d2, geometry: [[b.lat, b.lng], [proj.projLat, proj.projLng]], routeId: e.routeId, bidirectional: true });
  }
  for (const ne of newEdges) {
    working.edges.push(ne);
    if (!working.adj.has(ne.from)) working.adj.set(ne.from, []);
    working.adj.get(ne.from).push(ne);
  }

  const result = dijkstra(working, virtualId, destId);
  if (!result) return null;
  return { ...result, virtualId, snapDistance: proj.distance, graph: working };
}

export function kShortestPaths(graph, sourceId, destId, K = 3) {
  const results = [];
  // Edge removal is exploratory; operate on a throwaway copy so the caller's graph is stable.
  const working = cloneGraph(graph);
  const shortest = dijkstra(working, sourceId, destId);
  if (!shortest) return results;
  results.push(shortest);
  const removed = new Set();
  let attempts = 0;
  while (results.length < K && attempts < K * 5) {
    attempts++;
    const base = results[results.length - 1];
    if (!base || !base.edges.length) break;
    let found = false;
    for (let i = 0; i < base.edges.length; i++) {
      const edgeId = base.edges[i].id;
      if (removed.has(edgeId)) continue;
      removed.add(edgeId);
      working.edges = working.edges.filter((e) => e.id !== edgeId);
      rebuildAdj(working);
      const r = dijkstra(working, sourceId, destId);
      if (r) {
        const key = r.edges.map((e) => e.id).join(',');
        if (!results.some((x) => x.edges.map((e) => e.id).join(',') === key)) {
          results.push(r);
          found = true;
          break;
        }
      }
    }
    if (!found) break;
  }
  return results;
}

export function nearestNode(graph, lat, lng) {
  let best = null;
  for (const n of graph.nodes) {
    const d = hav({ lat: n.lat, lng: n.lng }, { lat, lng });
    if (!best || d < best.distance) best = { node: n, distance: d };
  }
  return best;
}
export function pathGeometry(graph, result) {
  if (!graph || !result || !Array.isArray(result.edges)) return [];
  const pts = [];
  for (const e of result.edges) {
    const a = graph.nodes[e.from], b = graph.nodes[e.to];
    if (!a || !b) continue;
    if (pts.length === 0) pts.push({ latitude: a.lat, longitude: a.lng });
    pts.push({ latitude: b.lat, longitude: b.lng });
  }
  // dedupe consecutive duplicates
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last.latitude !== p.latitude || last.longitude !== p.longitude) out.push(p);
  }
  return out;
}

/** Minimum distance in metres from a point to one polyline segment. */
function pointSegmentDistance(point, a, b) {
  const p = { lat: point.latitude, lng: point.longitude };
  const dLat = b.lat - a.lat, dLng = b.lng - a.lng;
  const len2 = dLat * dLat + dLng * dLng;
  let t = 0;
  if (len2 > 0) t = Math.max(0, Math.min(1, ((p.lat - a.lat) * dLat + (p.lng - a.lng) * dLng) / len2));
  return hav({ lat: a.lat + t * dLat, lng: a.lng + t * dLng }, p);
}

/** Directed Hausdorff-style maximum deviation between two polylines. */
function polylineDeviation(from, to) {
  const line = to.map((p) => ({ lat: p.latitude, lng: p.longitude }));
  if (!from.length || line.length < 2) return Infinity;
  let worst = 0;
  for (const raw of from) {
    let best = Infinity;
    for (let i = 0; i < line.length - 1; i += 1) {
      best = Math.min(best, pointSegmentDistance(raw, line[i], line[i + 1]));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

/**
 * Reroute support: find a path from the device's projected position to the destination
 * using ONLY published route geometry. Returns null when no verified path exists, so the
 * caller can honestly report that no alternative is available.
 */
export function alternativeFromPosition(graph, position, destinationNodeId, activePoints = [], options = {}) {
  const maxSnapM = options.maxSnapM ?? 25;
  const result = routeFromPosition(graph, position?.latitude, position?.longitude, destinationNodeId, maxSnapM);
  if (!result) return null;
  const points = pathGeometry(result.graph, result);
  if (points.length < 2) return null;
  // If both polylines follow the same geometry, it is not a change of path. Endpoints
  // alone cannot decide this: every alternative shares the same start and destination.
  const active = Array.isArray(activePoints) ? activePoints : [];
  const onActive = active.length > 1
    && polylineDeviation(points, active) <= 5
    && polylineDeviation(active, points) <= 5;
  if (onActive) return null;
  return {
    distance: result.distance,
    snapDistance: result.snapDistance,
    points,
    segments: [points],
    graph: result.graph,
  };
}
