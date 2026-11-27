import test from 'node:test';
import assert from 'node:assert';
import { buildGraph, shortestPath, kShortestPaths, projectPointToGraph, routeFromPosition, nearestNode } from '../src/lib/routeGraph.js';

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
