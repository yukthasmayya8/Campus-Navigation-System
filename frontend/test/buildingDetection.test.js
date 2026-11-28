import test from 'node:test';
import assert from 'node:assert';
import {
  resolveBuilding, trackBuilding, pointInVerifiedBoundary,
  navigationSource, formatBuildingStatus, DETECTION_LIMITS,
} from '../src/lib/buildingDetection.js';

const M = 1 / 111320;
const atMetres = (m) => ({ latitude: 13 + m * M, longitude: 74 });
const fix = (m, accuracy = 5, timestamp = Date.now()) => ({ ...atMetres(m), accuracy, timestamp });
const buildings = [
  { locationId: 1, name: 'Admin Block', ...atMetres(0) },
  { locationId: 2, name: 'Library', ...atMetres(40) },
];

test('without verified boundaries, detection is explicitly approximate', () => {
  const r = resolveBuilding(fix(6), buildings);
  assert.strictEqual(r.status, 'approximate');
  assert.strictEqual(r.buildingId, 1);
  assert.strictEqual(r.source, 'reference_coordinate');
  assert.notStrictEqual(r.confidence, 'high');
  assert.match(r.explanation, /Approximate/);
  assert.match(r.explanation, /Not confirmed inside/);
});

test('poor accuracy and stale fixes produce no building claim', () => {
  assert.strictEqual(resolveBuilding(fix(0, 45), buildings).status, 'unavailable');
  assert.strictEqual(resolveBuilding(fix(0, 45), buildings).buildingId, null);
  const now = Date.now();
  const stale = resolveBuilding({ ...fix(0, 5, now - 60000) }, buildings, { now: () => now });
  assert.strictEqual(stale.status, 'unavailable');
  assert.match(stale.explanation, /stale/);
});

test('equidistant reference points mean between buildings, not inside one', () => {
  const pair = [
    { locationId: 1, name: 'Admin Block', ...atMetres(-10) },
    { locationId: 2, name: 'Library', ...atMetres(10) },
  ];
  const r = resolveBuilding(fix(0), pair);
  assert.strictEqual(r.status, 'between');
  assert.strictEqual(r.buildingId, null);
  assert.match(r.explanation, /Between/);
});

test('only an explicitly supplied boundary can claim "inside"', () => {
  const square = [
    { latitude: 13 - 0.0001, longitude: 74 - 0.0001 },
    { latitude: 13 + 0.0001, longitude: 74 - 0.0001 },
    { latitude: 13 + 0.0001, longitude: 74 + 0.0001 },
    { latitude: 13 - 0.0001, longitude: 74 + 0.0001 },
  ];
  const withBoundary = [{ ...buildings[0], boundary: square }];
  assert.strictEqual(pointInVerifiedBoundary(atMetres(0), withBoundary[0]), true);
  assert.strictEqual(pointInVerifiedBoundary(atMetres(100), withBoundary[0]), false);
  const r = resolveBuilding(fix(0), withBoundary);
  assert.strictEqual(r.status, 'inside');
  assert.strictEqual(r.source, 'verified_boundary');
  assert.strictEqual(r.confidence, 'high');
});

test('approximate switches need three consistent fixes and a clear improvement', () => {
  const previous = resolveBuilding(fix(0), buildings);
  const candidate = resolveBuilding(fix(40), buildings);
  assert.strictEqual(candidate.buildingId, 2);
  let tracked = trackBuilding(previous, candidate);
  assert.strictEqual(tracked.buildingId, 1); // held by hysteresis
  assert.strictEqual(tracked.pendingStreak, 1);
  tracked = trackBuilding(tracked, candidate);
  assert.strictEqual(tracked.buildingId, 1);
  assert.strictEqual(tracked.pendingStreak, 2);
  tracked = trackBuilding(tracked, candidate);
  assert.strictEqual(tracked.buildingId, 2);
  assert.strictEqual(tracked.pendingId, null);

  const stillPrevious = resolveBuilding(fix(4), buildings);
  const held = trackBuilding(previous, stillPrevious);
  assert.strictEqual(held.buildingId, 1);
  assert.strictEqual(held.pendingId, null, 'no competing building means no pending switch');
});

test('building suggestion is never the navigation source', () => {
  const observation = resolveBuilding(fix(6), buildings);
  const gpsOnly = navigationSource(null, observation);
  assert.strictEqual(gpsOnly.source, null);
  assert.strictEqual(gpsOnly.sourceKind, 'gps-point');
  assert.strictEqual(gpsOnly.buildingSuggestion.buildingId, 1);

  const manual = { id: 2, label: 'Library' };
  const explicit = navigationSource(manual, observation);
  assert.strictEqual(explicit.source, manual);
  assert.strictEqual(explicit.sourceKind, 'manual');
});

test('status text never presents reference distance as distance to the building', () => {
  const status = formatBuildingStatus(resolveBuilding(fix(6), buildings));
  assert.match(status.current, /approximate/i);
  assert.match(status.reference, /Reference-point distance/);
  assert.doesNotMatch(status.reference, /distance to building/i);
  assert.ok(DETECTION_LIMITS.maxAccuracyM > 0);
});
