import test from 'node:test';
import assert from 'node:assert';
import { haversine, pathLength, locateOnPath, GpsFilter, splitAtGaps, splitAtTimeGaps, formatDistance, formatWalkTime, formatDuration, segmentsLength } from '../src/lib/geo.js';
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
  const f = new GpsFilter(); const t = Date.now();
  assert.strictEqual(f.accept({ ...line[0], accuracy: 80, timestamp: t }).reason, 'low_accuracy');
  assert.ok(f.accept({ ...line[0], accuracy: 5, timestamp: t }).ok);
  assert.strictEqual(f.accept({ ...line[2], accuracy: 5, timestamp: t + 1000 }).reason, 'jump'); // 100 m in 1 s
  assert.ok(f.accept({ ...line[1], accuracy: 5, timestamp: t + 10000 }).ok);
});

test('GpsFilter rejects stale and out-of-order fixes', () => {
  const now = Date.now();
  const f = new GpsFilter({ now: () => now });
  assert.ok(f.accept({ ...line[0], accuracy: 5, timestamp: now - 1000 }).ok);
  assert.strictEqual(f.accept({ ...line[1], accuracy: 5, timestamp: now - 60000 }).reason, 'stale');
  assert.strictEqual(f.accept({ ...line[1], accuracy: 5, timestamp: now - 2000 }).reason, 'stale');
});
test('PathTracker: off-path needs 3 consecutive bad fixes; arrival detected', () => {
  const tr = new PathTracker(line);
  let t = Date.now() - 18000;
  const fix = (lat, lngOff = 0) => ({ latitude: lat, longitude: 74 + lngOff, accuracy: 5, timestamp: (t += 6000) });
  const off = 60 * M / Math.cos(13 * Math.PI / 180);
  assert.strictEqual(tr.update(fix(13 + 10 * M, off)).offPath, false);
  assert.strictEqual(tr.update(fix(13 + 12 * M, off)).offPath, false);
  assert.strictEqual(tr.update(fix(13 + 14 * M, off)).offPath, true);
  const tr2 = new PathTracker(line); t = Date.now() - 6000;
  assert.strictEqual(tr2.update(fix(13 + 95 * M)).arrived, true);
});
test('offline alternatives: reverse only for bidirectional, never one-way', () => {
  const mk = (routeId, s, d, directionality) => ({ routeId, sourceLocationId: s, destinationLocationId: d, directionality, hasStairs: null, hasRamp: null, isCovered: null,
    points: [{ sequenceNumber: 1, latitude: 1, longitude: 1 }, { sequenceNumber: 2, latitude: 2, longitude: 2 }], waypoints: [] });
  const res = alternativesFrom([mk(1, 1, 2, 'one_way'), mk(2, 2, 1, 'bidirectional'), mk(3, 2, 1, 'one_way')], 1, 2);
  assert.deepStrictEqual(res.map((r) => r.routeId), [1, 2]);
  assert.strictEqual(res[1].reversed, true); assert.strictEqual(res[1].points[0].latitude, 2);
});

test('splitAtGaps splits only at valid interior gap indexes', () => {
  const pts = [0, 1, 2, 3].map((i) => ({ sequenceNumber: i + 1, latitude: 13 + i * M, longitude: 74 }));
  assert.deepStrictEqual(splitAtGaps(pts, [1]).map((p) => p.length), [2, 2]);
  assert.deepStrictEqual(splitAtGaps(pts, []).map((p) => p.length), [4]);
  assert.deepStrictEqual(splitAtGaps(pts, [3, -1, 9]).map((p) => p.length), [4]); // endpoint/out-of-range gaps ignored
  assert.deepStrictEqual(splitAtGaps([], [0]), []);
});

test('splitAtTimeGaps splits saved routes where fix timestamps jump', () => {
  const at = (sec) => ({ sequenceNumber: sec + 1, latitude: 13 + sec * M, longitude: 74, recordedAt: new Date(1_700_000_000_000 + sec * 1000).toISOString() });
  assert.deepStrictEqual(splitAtTimeGaps([at(0), at(1), at(2)]).map((p) => p.length), [3]);
  assert.deepStrictEqual(splitAtTimeGaps([at(0), at(1), at(40), at(41)]).map((p) => p.length), [2, 2]);
  // Seed data has no timestamps; it must stay one continuous line.
  const noTime = [0, 1, 2].map((i) => ({ latitude: 13 + i * M, longitude: 74 }));
  assert.deepStrictEqual(splitAtTimeGaps(noTime).map((p) => p.length), [3]);
});

test('display formatting: distances, walking time and recording duration', () => {
  assert.strictEqual(formatDistance(450), '450 m');
  assert.strictEqual(formatDistance(1234), '1.23 km');
  assert.strictEqual(formatDistance(null), '—');
  assert.strictEqual(formatWalkTime(30), '<1 min');
  assert.strictEqual(formatWalkTime(800), '~10 min');
  assert.strictEqual(formatWalkTime(4800), '1 h 0 min');
  assert.strictEqual(formatDuration(0), '0:00');
  assert.strictEqual(formatDuration(65000), '1:05');
  assert.strictEqual(formatDuration(3661000), '1:01:01');
});


test('PathTracker: a recorded GPS gap is not counted as walkable distance', () => {
  const gapM = 30;
  const seg1 = [0, 50].map((m) => ({ latitude: 13 + m * M, longitude: 74 }));
  const seg2 = [50 + gapM, 100 + gapM].map((m) => ({ latitude: 13 + m * M, longitude: 74 }));
  const allPoints = [...seg1, ...seg2];
  const tr = new PathTracker(allPoints, { segments: [seg1, seg2] });
  let t = Date.now() - 10000;
  const fixAt = (pt) => ({ latitude: pt.latitude, longitude: pt.longitude, accuracy: 5, timestamp: (t += 10000) });
  const r1 = tr.update(fixAt(seg1[1]));
  // Remaining distance is only the later walkable segment; the 30 m gap jump is excluded.
  near(r1.remainingMeters, pathLength(seg2), 2);
  assert.strictEqual(r1.arrived, false);
  assert.ok(segmentsLength([seg1, seg2]) < pathLength(allPoints));
});

test('PathTracker keeps the raw device position separate from the route projection', () => {
  const tr = new PathTracker(line);
  const eastOffset = 10 * M / Math.cos(13 * Math.PI / 180);
  const raw = { latitude: 13 + 25 * M, longitude: 74 + eastOffset, accuracy: 8, timestamp: Date.now() };
  const r = tr.update(raw);
  assert.ok(r.ok);
  assert.strictEqual(r.position.longitude, raw.longitude, 'filtered position is still the device position');
  near(r.distanceFromPath, 10, 1);
  near(r.remainingMeters, 75, 1);
  near(r.projected.latitude, 13 + 25 * M, 1e-6);
  assert.notStrictEqual(r.projected.longitude, raw.longitude, 'projection is not the raw GPS marker');
});
