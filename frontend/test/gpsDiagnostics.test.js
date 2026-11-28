import test from 'node:test';
import assert from 'node:assert';
import { buildGpsDiagnostics, formatDiagnosticsText } from '../src/lib/gpsDiagnostics.js';
import { haversine } from '../src/lib/geo.js';

test('diagnostics report raw and filtered coordinates and their distance', () => {
  const raw = { latitude: 13, longitude: 74, accuracy: 8, timestamp: Date.now() };
  const filtered = { latitude: 13.0001, longitude: 74.0001, accuracy: 8, timestamp: raw.timestamp };
  const d = buildGpsDiagnostics({ rawGps: raw, filteredGps: filtered, gpsState: 'high' });
  assert.strictEqual(d.raw.latitude, raw.latitude);
  assert.strictEqual(d.filtered.latitude, filtered.latitude);
  assert.ok(Math.abs(d.filtered.distanceFromRawM - haversine(raw, filtered)) < 0.001);
  assert.match(formatDiagnosticsText(d), /Raw GPS:/);
});

test('diagnostics use N/A for missing values', () => {
  const d = buildGpsDiagnostics({});
  assert.strictEqual(d.raw.latitude, null);
  assert.strictEqual(d.filtered.longitude, null);
  assert.strictEqual(d.routeMatching.routeId, null);
  assert.strictEqual(d.building.suggested, null);
  assert.match(formatDiagnosticsText(d), /N\/A/);
});

test('diagnostics reflect building ambiguity and approximate status', () => {
  const d = buildGpsDiagnostics({
    currentBuilding: {
      status: 'between',
      buildingName: null,
      distanceMeters: 12,
      explanation: 'Between A and B',
      source: 'reference_coordinate',
      alternatives: [{ name: 'Library', distanceMeters: 14 }],
    },
  });
  assert.strictEqual(d.building.ambiguityState, 'between');
  assert.strictEqual(d.building.approximate, true);
  assert.strictEqual(d.building.verifiedBoundary, false);
  assert.strictEqual(d.building.secondCandidate, 'Library');
});

test('diagnostics do not report arrival prematurely', () => {
  const d = buildGpsDiagnostics({
    navInfo: { arrived: false, remainingMeters: 42, distanceFromPath: 3, matchConfidence: 'moderate', offPath: false },
  });
  assert.strictEqual(d.arrival.arrived, false);
  assert.strictEqual(d.arrival.confirmed, false);
  assert.strictEqual(d.routeMatching.onRoute, true);
});

test('diagnostics report off-route counter and threshold', () => {
  const tracker = { strikes: 2, opts: { offPathFixes: 3, arrivalMeters: 15 } };
  const d = buildGpsDiagnostics({
    navInfo: { offPath: false, remainingMeters: 100, distanceFromPath: 12, matchConfidence: 'low' },
    tracker,
  });
  assert.strictEqual(d.routeMatching.offRouteCounter, 2);
  assert.strictEqual(d.routeMatching.offRouteThreshold, 3);
});
