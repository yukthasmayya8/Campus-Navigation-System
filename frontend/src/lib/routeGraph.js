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
  const adj = new Map();
  const ensure = (id) => { if (!adj.has(id)) adj.set(id, []); };
  for (const e of edges) { ensure(e.from); ensure(e.to); adj.get(e.from).push(e); }

  return { nodes, edges, adj };
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
  const proj = projectPointToGraph(graph, lat, lng);
  if (!proj || proj.distance > maxSnapM) return null;
  // create virtual node
  const virtualId = graph.nodes.length;
  graph.nodes.push({ id: virtualId, lat: proj.projLat, lng: proj.projLng, virtual: true });
  // split edge: remove original, add two edges through virtual node
  const e = proj.edge;
  const a = graph.nodes[e.from], b = graph.nodes[e.to];
  const d1 = hav({ lat: a.lat, lng: a.lng }, { lat: proj.projLat, lng: proj.projLng });
  const d2 = hav({ lat: proj.projLat, lng: proj.projLng }, { lat: b.lat, lng: b.lng });
  // remove original edge (both directions) from edges and adj
  const toRemove = new Set([e.id]);
  // find reverse edge
  for (const oe of graph.edges) {
    if (oe.from === e.to && oe.to === e.from && oe.routeId === e.routeId) toRemove.add(oe.id);
  }
  graph.edges = graph.edges.filter((x) => !toRemove.has(x.id));
  // rebuild adj
  graph.adj = new Map();
  const ensure = (id) => { if (!graph.adj.has(id)) graph.adj.set(id, []); };
  for (const node of graph.nodes) ensure(node.id);
  for (const oe of graph.edges) { ensure(oe.from); graph.adj.get(oe.from).push(oe); }

  // add new edges through virtual node
  const newEdges = [
    { id: graph.edges.length, from: e.from, to: virtualId, distance: d1, geometry: [[a.lat, a.lng], [proj.projLat, proj.projLng]], routeId: e.routeId, bidirectional: e.bidirectional },
    { id: graph.edges.length + 1, from: virtualId, to: e.to, distance: d2, geometry: [[proj.projLat, proj.projLng], [b.lat, b.lng]], routeId: e.routeId, bidirectional: e.bidirectional },
  ];
  if (e.bidirectional) {
    newEdges.push({ id: graph.edges.length + 2, from: virtualId, to: e.from, distance: d1, geometry: [[proj.projLat, proj.projLng], [a.lat, a.lng]], routeId: e.routeId, bidirectional: true });
    newEdges.push({ id: graph.edges.length + 3, from: e.to, to: virtualId, distance: d2, geometry: [[b.lat, b.lng], [proj.projLat, proj.projLng]], routeId: e.routeId, bidirectional: true });
  }
  for (const ne of newEdges) {
    graph.edges.push(ne);
    graph.adj.get(ne.from).push(ne);
  }

  const result = dijkstra(graph, virtualId, destId);
  return { ...result, virtualId, snapDistance: proj.distance };
}

export function kShortestPaths(graph, sourceId, destId, K = 3) {
  const results = [];
  const shortest = dijkstra(graph, sourceId, destId);
  if (!shortest) return results;
  results.push(shortest);
  // simple: remove each edge of found paths and recompute
  const removed = new Set();
  let attempts = 0;
  while (results.length < K && attempts < K * 5) {
    attempts++;
    // pick a path to deviate from
    const base = results[results.length - 1];
    if (!base || !base.edges.length) break;
    // remove one edge at a time
    let found = false;
    for (let i = 0; i < base.edges.length; i++) {
      const edgeId = base.edges[i].id;
      if (removed.has(edgeId)) continue;
      removed.add(edgeId);
      // temporarily remove
      const saved = graph.edges.filter((e) => e.id === edgeId);
      graph.edges = graph.edges.filter((e) => e.id !== edgeId);
      // rebuild adj
      graph.adj = new Map();
      const ensure = (id) => { if (!graph.adj.has(id)) graph.adj.set(id, []); };
      for (const n of graph.nodes) ensure(n.id);
      for (const oe of graph.edges) { ensure(oe.from); graph.adj.get(oe.from).push(oe); }
      const r = dijkstra(graph, sourceId, destId);
      // restore
      graph.edges.push(...saved);
      graph.adj = new Map();
      for (const n of graph.nodes) graph.adj.set(n.id, []);
      for (const oe of graph.edges) graph.adj.get(oe.from).push(oe);
      if (r) {
        // check not duplicate
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
