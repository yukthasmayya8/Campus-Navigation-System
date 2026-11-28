import test from 'node:test';
import assert from 'node:assert';
import { buildGraph, shortestPath, kShortestPaths, projectPointToGraph, routeFromPosition, nearestNode, alternativeFromPosition, pathGeometry } from '../src/lib/routeGraph.js';

const M = 1 / 111320;
// A--B--C--D line (100m segments)
const linePts = [0, 100, 200, 300].map((m) => ({ latitude: 13 + m * M, longitude: 74 }));
const route = { routeId: 1, directionality: 'bidirectional', points: linePts };
const graph = buildGraph([route]);

test('buildGraph creates nodes and edges', () => {
  assert.ok(graph.nodes.length >= 4);
  assert.ok(graph.edges.length >= 6); // 3 segments * 2 (bidirectional)
});

test('shortestPath A to D', () => {
  const r = shortestPath(graph, 0, graph.nodes.length - 1);
  assert.ok(r);
  assert.ok(r.distance > 290 && r.distance < 310);
});

test('shortestPath reverse D to A', () => {
  const r = shortestPath(graph, graph.nodes.length - 1, 0);
  assert.ok(r);
  assert.ok(r.distance > 290 && r.distance < 310);
});

test('projectPointToGraph finds nearest edge', () => {
  const mid = { lat: 13 + 150 * M, lng: 74 };
  const p = projectPointToGraph(graph, mid.lat, mid.lng);
  assert.ok(p);
  assert.ok(p.distance < 1);
});

test('routeFromPosition from intermediate point', () => {
  const midLat = 13 + 150 * M;
  const r = routeFromPosition(graph, midLat, 74, graph.nodes.length - 1, 40);
  assert.ok(r);
  assert.ok(r.distance > 140 && r.distance < 160);
});

test('kShortestPaths returns at least one', () => {
  const r = kShortestPaths(graph, 0, graph.nodes.length - 1, 2);
  assert.ok(r.length >= 1);
});

test('routeFromPosition and kShortestPaths never mutate the shared graph', () => {
  const nodesBefore = graph.nodes.length;
  const edgesBefore = graph.edges.length;
  const midLat = 13 + 150 * M;
  const r = routeFromPosition(graph, midLat, 74, graph.nodes.length - 1, 40);
  assert.ok(r);
  assert.ok(r.graph.nodes.length > graph.nodes.length, 'virtual start node lives in the returned clone');
  assert.strictEqual(graph.nodes.length, nodesBefore);
  assert.strictEqual(graph.edges.length, edgesBefore);
  assert.ok(pathGeometry(r.graph, r).length >= 2);
  kShortestPaths(graph, 0, graph.nodes.length - 1, 2);
  assert.strictEqual(graph.edges.length, edgesBefore);
});

test('routeFromPosition returns null when no verified graph path exists', () => {
  const farRoute = { routeId: 2, directionality: 'bidirectional', points: [0, 50].map((m) => ({ latitude: 14 + m * M, longitude: 75 })) };
  const disconnected = buildGraph([route, farRoute]);
  const destInOtherComponent = nearestNode(disconnected, 14, 75).node.id;
  const nearOwnPath = { latitude: 13 + 50 * M, longitude: 74 };
  assert.strictEqual(routeFromPosition(disconnected, nearOwnPath.latitude, nearOwnPath.longitude, destInOtherComponent, 20), null);
  assert.strictEqual(routeFromPosition(disconnected, 13, 74, destInOtherComponent, 5), null, 'too far from any published path');
});

test('alternativeFromPosition suggests only a different published path, with confirmation left to the caller', () => {
  const east = 100 * M / Math.cos(13 * Math.PI / 180);
  const a = { latitude: 13, longitude: 74 };
  const b = { latitude: 13 + 100 * M, longitude: 74 };
  const c = { latitude: 13, longitude: 74 + east };
  const direct = { routeId: 10, directionality: 'bidirectional', points: [a, b] };
  const detour = { routeId: 11, directionality: 'bidirectional', points: [a, c, b] };
  const g = buildGraph([direct, detour]);
  const dest = nearestNode(g, b.latitude, b.longitude).node.id;
  const candidate = alternativeFromPosition(g, a, dest, detour.points.map((p) => ({ latitude: p.latitude, longitude: p.longitude })), { maxSnapM: 20 });
  assert.ok(candidate);
  assert.strictEqual(candidate.points.length, 2, 'the direct verified path is the alternative to the detour');
  assert.ok(candidate.distance > 95 && candidate.distance < 105);
  assert.ok(candidate.graph);

  const samePath = alternativeFromPosition(g, a, dest, direct.points.map((p) => ({ latitude: p.latitude, longitude: p.longitude })), { maxSnapM: 20 });
  assert.strictEqual(samePath, null, 'a suggestion that follows the active route is not a reroute');
});
