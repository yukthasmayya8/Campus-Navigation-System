/**
 * Shared browser-geolocation capture logic.
 *
 * One implementation is used by admin building capture and public "start from my
 * location" actions. It never returns coordinates without the reported accuracy and
 * timestamp, and it never treats enableHighAccuracy as a guarantee of good accuracy.
 */
import { GPS_THRESHOLDS } from './gpsThresholds.js';

export const CAPTURE_LIMITS = Object.freeze({
  /** Preferred accuracy; capture completes as soon as a fix this good arrives. */
  targetAccuracyM: GPS_THRESHOLDS.captureTargetM,
  /** Fixes worse than this are never silently accepted. */
  maxAccuracyM: GPS_THRESHOLDS.captureMaxM,
  /** A fix older than this is not accepted. */
  maxAgeMs: GPS_THRESHOLDS.captureStaleMs,
  /** Total time spent waiting for an acceptable fix. */
  maxWaitMs: 20000,
  /** Per-request timeout passed to the Geolocation API. */
  timeoutMs: 15000,
  /** Extra collection window after a good fix so capture stability can be assessed. */
  stabilityWindowMs: 1000,
});

const EARTH_R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
function haversineMeters(a, b) {
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export class GpsCaptureError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GpsCaptureError';
    this.code = code;
    this.details = details;
  }
}

/** Geolocation requires HTTPS (or localhost) on real devices. */
export function secureContextAllowed(win = globalThis.window) {
  if (!win) return true; // injected geolocation in unit tests
  return Boolean(win.isSecureContext || win.location?.hostname === 'localhost');
}

export function geolocationErrorMessage(err) {
  if (err instanceof GpsCaptureError) return err.message;
  if (err?.code === 1) return 'Location permission denied. Allow location access in your browser settings, then retry.';
  if (err?.code === 2) return 'Position unavailable. Move outdoors, enable device location services, then retry.';
  if (err?.code === 3) return 'Location request timed out. Move to an open area and retry.';
  return err?.message || 'Could not get your location.';
}

export function normalisePosition(position) {
  const timestamp = Number.isFinite(position?.timestamp) ? position.timestamp : Date.now();
  return {
    latitude: position?.coords?.latitude,
    longitude: position?.coords?.longitude,
    accuracy: Number.isFinite(position?.coords?.accuracy) ? position.coords.accuracy : null,
    timestamp,
    capturedAt: new Date(timestamp).toISOString(),
  };
}

export function validateCapture(fix, options = {}) {
  const cfg = { ...CAPTURE_LIMITS, ...options };
  const now = typeof cfg.now === 'function' ? cfg.now() : Date.now();
  if (!fix || !Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)
    || fix.latitude < -90 || fix.latitude > 90 || fix.longitude < -180 || fix.longitude > 180) {
    return { ok: false, reason: 'invalid_coordinates', message: 'The browser returned invalid coordinates.' };
  }
  if (!Number.isFinite(fix.accuracy)) {
    return { ok: false, reason: 'no_accuracy', message: 'The browser did not report GPS accuracy.' };
  }
  if (Number.isFinite(fix.timestamp) && Math.abs(now - fix.timestamp) > cfg.maxAgeMs) {
    return { ok: false, reason: 'stale', message: 'The GPS fix is stale. Waiting for a fresh position.' };
  }
  if (fix.accuracy > cfg.maxAccuracyM) {
    return {
      ok: false, reason: 'poor_accuracy',
      message: `GPS accuracy is about ${Math.round(fix.accuracy)} m. Waiting for ${cfg.maxAccuracyM} m or better.`,
      accuracy: fix.accuracy,
    };
  }
  return { ok: true, reason: 'ok', message: '' };
}

/** Lower reported accuracy wins; ties go to the newer fix. */
export function selectBestFix(current, candidate) {
  if (!candidate || !Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)
    || !Number.isFinite(candidate.accuracy)) return current ?? null;
  if (!current) return candidate;
  if (candidate.accuracy < current.accuracy) return candidate;
  if (candidate.accuracy === current.accuracy && candidate.timestamp > current.timestamp) return candidate;
  return current;
}

/** Strings used by the admin form; the saved values come from these, not from a map guess. */
export function formatFixCoordinates(fix) {
  return {
    latitude: Number(fix.latitude).toFixed(7),
    longitude: Number(fix.longitude).toFixed(7),
  };
}

/** Validate user-entered or captured coordinates before any save request. */
export function validateCoordinateInput(latitude, longitude) {
  const lat = typeof latitude === 'string' ? latitude.trim() : latitude;
  const lng = typeof longitude === 'string' ? longitude.trim() : longitude;
  if (lat === '' || lat == null || lng === '' || lng == null) {
    return { ok: false, reason: 'required', message: 'Latitude and longitude are required.' };
  }
  const parsedLat = Number(lat), parsedLng = Number(lng);
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
    return { ok: false, reason: 'invalid', message: 'Latitude and longitude must be numbers.' };
  }
  if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
    return { ok: false, reason: 'out_of_range', message: 'Latitude must be between -90 and 90; longitude between -180 and 180.' };
  }
  return { ok: true, latitude: parsedLat, longitude: parsedLng };
}

/**
 * Wait for an acceptable one-shot GPS fix using the device's own Geolocation API.
 * `geolocation` is injectable so the behaviour is unit-testable without a browser.
 */
export function captureBestPosition(options = {}, geolocation = globalThis.navigator?.geolocation) {
  const cfg = { ...CAPTURE_LIMITS, ...options };
  return new Promise((resolve, reject) => {
    if (cfg.signal?.aborted) {
      reject(new GpsCaptureError('cancelled', 'Location capture was cancelled.'));
      return;
    }
    if (!geolocation || typeof geolocation.watchPosition !== 'function') {
      reject(new GpsCaptureError('unsupported', 'This browser does not support location access. Use a modern mobile browser.'));
      return;
    }
    if (!secureContextAllowed(cfg.window)) {
      reject(new GpsCaptureError('insecure', 'Location access requires HTTPS (or localhost). Open this site over https:// and retry.'));
      return;
    }

    let settled = false;
    let watchId = null;
    let timer = null;
    let stabilityTimer = null;
    let best = null;
    let poorBest = null;
    let sawFix = false;
    let lastError = null;
    const acceptedFixes = [];

    const cleanup = () => {
      if (watchId !== null && typeof geolocation.clearWatch === 'function') {
        try { geolocation.clearWatch(watchId); } catch { /* ignore */ }
      }
      if (timer !== null) clearTimeout(timer);
      if (stabilityTimer !== null) clearTimeout(stabilityTimer);
      cfg.signal?.removeEventListener?.('abort', onAbort);
    };
    const onAbort = () => finish(new GpsCaptureError('cancelled', 'Location capture was cancelled.'));
    function finish(error = null) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) { reject(error); return; }
      if (!best) {
        const reason = lastError?.code === 1 ? 'permission_denied'
          : lastError?.code === 2 ? 'unavailable'
            : lastError?.code === 3 ? 'timeout'
              : poorBest ? 'poor_accuracy' : 'timeout';
        const message = reason === 'poor_accuracy'
          ? `GPS accuracy stayed around ${Math.round(poorBest.accuracy)} m (need ${cfg.maxAccuracyM} m or better). Move outdoors and retry.`
          : reason === 'timeout' ? 'Location request timed out. Move to an open area and retry.'
            : geolocationErrorMessage(lastError || { code: 2 });
        reject(new GpsCaptureError(reason, message, { accuracy: poorBest?.accuracy ?? null }));
        return;
      }
      const quality = best.accuracy <= cfg.targetAccuracyM ? 'good' : 'acceptable';
      const spreadMeters = acceptedFixes.length >= 2
        ? Math.max(...acceptedFixes.map((f) => haversineMeters(f, best)))
        : 0;
      const stabilityWarning = spreadMeters > 15
        ? `GPS position varied by about ${Math.round(spreadMeters)} m during capture. Review the pin carefully before saving.`
        : '';
      const accuracyWarning = quality === 'acceptable'
        ? `GPS accuracy is ±${Math.round(best.accuracy)} m, above the preferred ${cfg.targetAccuracyM} m. Review the pin before saving.`
        : '';
      resolve({
        fix: best,
        quality,
        spreadMeters,
        warning: [accuracyWarning, stabilityWarning].filter(Boolean).join(' '),
      });
    }

    cfg.signal?.addEventListener?.('abort', onAbort);
    // Start the overall deadline before subscribing: a synchronous injected provider
    // may settle the promise before `watchPosition` returns.
    timer = setTimeout(() => finish(), cfg.maxWaitMs);
    try {
      watchId = geolocation.watchPosition(
        (position) => {
          const fix = normalisePosition(position);
          const check = validateCapture(fix, cfg);
          if (!check.ok) {
            if (check.reason === 'poor_accuracy' || check.reason === 'stale') {
              poorBest = selectBestFix(poorBest, fix);
              lastError = null;
            }
            return;
          }
          sawFix = true;
          acceptedFixes.push(fix);
          best = selectBestFix(best, fix);
          lastError = null;
          if (best && best.accuracy <= cfg.targetAccuracyM) {
            if (stabilityTimer === null) {
              if (cfg.stabilityWindowMs <= 0) finish();
              else stabilityTimer = setTimeout(() => finish(), cfg.stabilityWindowMs);
            } else {
              clearTimeout(stabilityTimer);
              stabilityTimer = setTimeout(() => finish(), cfg.stabilityWindowMs);
            }
          }
        },
        (err) => {
          if (err?.code === 1) {
            finish(new GpsCaptureError('permission_denied', geolocationErrorMessage(err)));
            return;
          }
          lastError = err;
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: cfg.timeoutMs },
      );
    } catch (err) {
      finish(new GpsCaptureError('unavailable', geolocationErrorMessage(err)));
      return;
    }
    // If an injected provider delivered fixes synchronously, stop the watch now.
    if (settled) {
      try { geolocation.clearWatch?.(watchId); } catch { /* ignore */ }
    }
    // `sawFix` is kept for diagnostics but acceptance is based on validation, not count.
    void sawFix;
  });
}

/** Coarse, honest confidence classification for a single GPS fix. */
export function gpsConfidence(fix, limits = CAPTURE_LIMITS) {
  if (!fix || !Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) return 'unavailable';
  if (!Number.isFinite(fix.accuracy)) return 'unavailable';
  const now = Date.now();
  if (Number.isFinite(fix.timestamp) && Math.abs(now - fix.timestamp) > (limits.maxAgeMs || 15000)) return 'stale';
  if (fix.accuracy > (limits.maxAccuracyM || 30)) return 'low';
  if (fix.accuracy <= (limits.targetAccuracyM || 20)) return 'high';
  return 'moderate';
}
