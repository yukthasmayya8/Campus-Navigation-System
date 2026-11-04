const test = require('node:test');
const assert = require('node:assert');
const { reverseRoute, compareRoutes, diffSnapshots, escapeLike, validLat, validLng } = require('../src/utils/geo');
const { sniffImage } = require('../src/utils/image');

const route = (o) => ({ routeId: 1, sourceLocationId: 1, destinationLocationId: 2, hasStairs: null, hasRamp: null, isCovered: null,
  points: [{ sequenceNumber: 1, latitude: 1, longitude: 1 }, { sequenceNumber: 2, latitude: 2, longitude: 2 }, { sequenceNumber: 3, latitude: 3, longitude: 3 }],
  waypoints: [{ sequenceNumber: 1, locationId: 7 }, { sequenceNumber: 2, locationId: 8 }], reversed: false, ...o });

test('reverseRoute reverses points/waypoints, renumbers, swaps endpoints, flags reversed, does not mutate', () => {
  const r = route(); const rev = reverseRoute(r);
  assert.deepStrictEqual(rev.points.map((p) => p.latitude), [3, 2, 1]);
  assert.deepStrictEqual(rev.points.map((p) => p.sequenceNumber), [1, 2, 3]);
  assert.deepStrictEqual(rev.waypoints.map((w) => w.locationId), [8, 7]);
  assert.strictEqual(rev.sourceLocationId, 2); assert.strictEqual(rev.destinationLocationId, 1);
  assert.strictEqual(rev.reversed, true); assert.strictEqual(r.points[0].latitude, 1); assert.strictEqual(r.reversed, false);
});
test('sorting: verified no stairs > ramp > covered > id; NULL is not false', () => {
  const list = [route({ routeId: 5, hasStairs: null }), route({ routeId: 4, hasStairs: true }), route({ routeId: 3, hasStairs: false, hasRamp: null }),
    route({ routeId: 2, hasStairs: false, hasRamp: true }), route({ routeId: 1, hasStairs: false, hasRamp: true, isCovered: true })];
  assert.deepStrictEqual(list.sort(compareRoutes).map((r) => r.routeId), [1, 2, 3, 4, 5]);
});
test('diffSnapshots reports changed fields and point counts', () => {
  const d = diffSnapshots({ name: 'A', points: [1] }, { name: 'B', points: [1, 2] });
  assert.deepStrictEqual(d.map((c) => c.field).sort(), ['name', 'points']);
});
test('escapeLike neutralises wildcards', () => assert.strictEqual(escapeLike('50%_a\\'), '50\\%\\_a\\\\'));
test('coordinate validators', () => {
  assert.ok(validLat(90) && !validLat(91) && !validLat(NaN) && !validLat('1'));
  assert.ok(validLng(-180) && !validLng(181) && !validLng(Infinity));
});
test('sniffImage checks content, not extension', () => {
  assert.strictEqual(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])).ext, 'jpg');
  assert.strictEqual(sniffImage(Buffer.from('<?php echo 1; ?> not an image')), null);
  assert.strictEqual(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])).ext, 'webp');
});
