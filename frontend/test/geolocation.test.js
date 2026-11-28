import test from 'node:test';
import assert from 'node:assert';
import {
  captureBestPosition, validateCapture, selectBestFix, formatFixCoordinates,
  validateCoordinateInput, secureContextAllowed, GpsCaptureError, CAPTURE_LIMITS,
} from '../src/lib/geolocation.js';

const position = (lat, lng, accuracy, timestamp = Date.now()) => ({
  coords: { latitude: lat, longitude: lng, accuracy }, timestamp,
});

function fakeGeolocation(fixes = [], { error = null, emit = 'sync' } = {}) {
  return {
    options: null,
    cleared: [],
    watchPosition(success, onError, options) {
      this.options = options;
      const deliver = () => {
        fixes.forEach((f) => success(f));
        if (error) onError(error);
      };
      if (emit === 'sync') deliver();
      else queueMicrotask(deliver);
      return 42;
    },
    clearWatch(id) { this.cleared.push(id); },
  };
}

test('validateCapture requires finite coordinates, accuracy and a fresh timestamp', () => {
  const now = Date.now();
  assert.strictEqual(validateCapture({ latitude: 13, longitude: 74, accuracy: 5, timestamp: now }, { now: () => now }).ok, true);
  assert.strictEqual(validateCapture({ latitude: NaN, longitude: 74, accuracy: 5, timestamp: now }, { now: () => now }).reason, 'invalid_coordinates');
  assert.strictEqual(validateCapture({ latitude: 13, longitude: 74, accuracy: null, timestamp: now }, { now: () => now }).reason, 'no_accuracy');
  assert.strictEqual(validateCapture({ latitude: 13, longitude: 74, accuracy: 5, timestamp: now - 60000 }, { now: () => now }).reason, 'stale');
  assert.strictEqual(validateCapture({ latitude: 13, longitude: 74, accuracy: 45, timestamp: now }, { now: () => now }).reason, 'poor_accuracy');
});

test('selectBestFix prefers lower accuracy, then newer fixes', () => {
  const older = { latitude: 1, longitude: 1, accuracy: 10, timestamp: 100 };
  const newer = { latitude: 2, longitude: 2, accuracy: 20, timestamp: 200 };
  const tight = { latitude: 3, longitude: 3, accuracy: 8, timestamp: 50 };
  assert.strictEqual(selectBestFix(older, newer), older);
  assert.strictEqual(selectBestFix(older, tight), tight);
  assert.strictEqual(selectBestFix(newer, { ...newer, timestamp: 300 }).timestamp, 300);
});

test('captureBestPosition waits past poor fixes and returns accuracy and timestamp', async () => {
  const now = Date.now();
  const geo = fakeGeolocation([
    position(13, 74, 45, now - 3000),
    position(13.00001, 74.00001, 12, now - 1000),
  ], { emit: 'microtask' });
  const result = await captureBestPosition({ signal: undefined }, geo);
  assert.strictEqual(result.quality, 'good');
  assert.strictEqual(result.fix.accuracy, 12);
  assert.strictEqual(result.fix.timestamp, now - 1000);
  assert.ok(result.fix.capturedAt.endsWith('Z'));
  assert.deepStrictEqual(geo.options, {
    enableHighAccuracy: true, maximumAge: 0, timeout: CAPTURE_LIMITS.timeoutMs,
  });
  assert.deepStrictEqual(geo.cleared, [42]);
});

test('acceptable-but-not-good fixes include a review warning', async () => {
  const geo = fakeGeolocation([position(13, 74, 25)], { emit: 'microtask' });
  const result = await captureBestPosition({ maxWaitMs: 50 }, geo);
  assert.strictEqual(result.quality, 'acceptable');
  assert.match(result.warning, /Review the pin/);
});

test('capture rejects when every fix is too inaccurate', async () => {
  const geo = fakeGeolocation([position(13, 74, 60)], { emit: 'microtask' });
  await assert.rejects(
    captureBestPosition({ maxWaitMs: 30, timeoutMs: 10 }, geo),
    (err) => err instanceof GpsCaptureError && err.code === 'poor_accuracy',
  );
});

test('capture can be cancelled and leaves no active watch', async () => {
  const controller = new AbortController();
  const geo = fakeGeolocation([], { emit: 'microtask' });
  const pending = captureBestPosition({ signal: controller.signal }, geo);
  controller.abort();
  await assert.rejects(pending, (err) => err.code === 'cancelled');
});

test('form helpers validate input before a coordinate is saved', () => {
  assert.deepStrictEqual(formatFixCoordinates({ latitude: 13.123456789, longitude: 74.987654321 }), {
    latitude: '13.1234568', longitude: '74.9876543',
  });
  assert.deepStrictEqual(validateCoordinateInput(' 13 ', '74'), { ok: true, latitude: 13, longitude: 74 });
  assert.strictEqual(validateCoordinateInput('', '74').reason, 'required');
  assert.strictEqual(validateCoordinateInput('abc', '74').reason, 'invalid');
  assert.strictEqual(validateCoordinateInput('91', '74').reason, 'out_of_range');
  assert.strictEqual(validateCoordinateInput('13', '181').reason, 'out_of_range');
});

test('secure context check is explicit rather than relying on enableHighAccuracy', () => {
  assert.strictEqual(secureContextAllowed({ isSecureContext: true, location: {} }), true);
  assert.strictEqual(secureContextAllowed({ isSecureContext: false, location: { hostname: 'example.com' } }), false);
  assert.strictEqual(secureContextAllowed({ isSecureContext: false, location: { hostname: 'localhost' } }), true);
});
