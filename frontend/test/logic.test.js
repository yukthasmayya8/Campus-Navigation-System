import test from 'node:test';
import assert from 'node:assert';
import { haversine, pathLength, locateOnPath, GpsFilter } from '../src/lib/geo.js';
import { PathTracker } from '../src/lib/tracker.js';
import { alternativesFrom } from '../src/lib/routeLogic.js';

const M = 1 / 111320; // degrees latitude per metre
const line = [0, 50, 100].map((m) => ({ latitude: 13 + m * M, longitude: 74 })); // 100 m north-south path
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('haversine / pathLength ~100 m', () => { near(haversine(line[0], line[2]), 100, 0.5); near(pathLength(line), 100, 0.5); });
test('locateOnPath: distance to path and remaining metres', () => {
  const east20 = { latitude: 13 + 25 * M, longitude: 74 + 20 * M / Math.cos(13 * Math.PI / 180) };
  const r = locateOnPath(east20, line);
  near(r.distance, 20, 0.5); near(r.remaining, 75, 1);
});
test('GpsFilter drops poor accuracy and impossible jumps, keeps good fixes', () => {
  const f = new GpsFilter(); const t = 1_000_000;
  assert.strictEqual(f.accept({ ...line[0], accuracy: 80, timestamp: t }).reason, 'low_accuracy');
  assert.ok(f.accept({ ...line[0], accuracy: 5, timestamp: t }).ok);
  assert.strictEqual(f.accept({ ...line[2], accuracy: 5, timestamp: t + 1000 }).reason, 'jump'); // 100 m in 1 s
  assert.ok(f.accept({ ...line[1], accuracy: 5, timestamp: t + 10000 }).ok);
});
test('PathTracker: off-path needs 3 consecutive bad fixes; arrival detected', () => {
  const tr = new PathTracker(line); let t = 0; const fix = (lat, lngOff = 0) => ({ latitude: lat, longitude: 74 + lngOff, accuracy: 5, timestamp: (t += 20000) });
  const off = 60 * M / Math.cos(13 * Math.PI / 180);
  assert.strictEqual(tr.update(fix(13 + 10 * M, off)).offPath, false);
  assert.strictEqual(tr.update(fix(13 + 12 * M, off)).offPath, false);
  assert.strictEqual(tr.update(fix(13 + 14 * M, off)).offPath, true);
  const tr2 = new PathTracker(line); t = 0;
  assert.strictEqual(tr2.update(fix(13 + 95 * M)).arrived, true);
});
test('offline alternatives: reverse only for bidirectional, never one-way', () => {
  const mk = (routeId, s, d, directionality) => ({ routeId, sourceLocationId: s, destinationLocationId: d, directionality, hasStairs: null, hasRamp: null, isCovered: null,
    points: [{ sequenceNumber: 1, latitude: 1, longitude: 1 }, { sequenceNumber: 2, latitude: 2, longitude: 2 }], waypoints: [] });
  const res = alternativesFrom([mk(1, 1, 2, 'one_way'), mk(2, 2, 1, 'bidirectional'), mk(3, 2, 1, 'one_way')], 1, 2);
  assert.deepStrictEqual(res.map((r) => r.routeId), [1, 2]);
  assert.strictEqual(res[1].reversed, true); assert.strictEqual(res[1].points[0].latitude, 2);
});
