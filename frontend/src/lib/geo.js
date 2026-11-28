/** Pure geo helpers for navigation and recording (no DOM, unit-tested). Distances in metres. */
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export const MAX_ACCURACY_M = 25;
export const MIN_SPACING_M = 3;
export const MAX_SPEED_MPS = 10;
export const GAP_AFTER_MS = 15000;

export function haversine(a, b) {
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Local flat projection around `origin` - accurate to centimetres over a campus. */
function project(p, origin) {
  return { x: rad(p.longitude - origin.longitude) * R * Math.cos(rad(origin.latitude)), y: rad(p.latitude - origin.latitude) * R };
}

/** Total length of a polyline of {latitude, longitude}. */
export function pathLength(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
  return d;
}

/**
 * Sum of walkable polyline lengths. Gaps between segments are deliberately excluded:
 * a recorded GPS gap is a break in evidence, not a walked distance.
 */
export function segmentsLength(segments = []) {
  return segments.reduce((total, seg) => total + pathLength(seg), 0);
}

/**
 * Distance from `pos` to the polyline, the nearest segment index, and metres left to walk
 * from the projected position to the end of the path.
 */
export function locateOnPath(pos, points) {
  if (!points.length) return { distance: Infinity, segment: -1, remaining: 0, point: null };
  if (points.length === 1) return { distance: haversine(pos, points[0]), segment: 0, remaining: 0, point: points[0] };
  const P = project(pos, pos);
  let best = { distance: Infinity, segment: 0, t: 0, x: 0, y: 0 };
  for (let i = 0; i < points.length - 1; i++) {
    const a = project(points[i], pos), b = project(points[i + 1], pos);
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((P.x - a.x) * dx + (P.y - a.y) * dy) / len2));
    const x = a.x + t * dx, y = a.y + t * dy;
    const d = Math.hypot(x - P.x, y - P.y);
    if (d < best.distance) best = { distance: d, segment: i, t, x, y };
  }
  const segLen = haversine(points[best.segment], points[best.segment + 1]);
  let remaining = segLen * (1 - best.t);
  for (let i = best.segment + 1; i < points.length - 1; i++) remaining += haversine(points[i], points[i + 1]);
  // Convert the local projection back to coordinates: a display-only route projection,
  // never a replacement for the device's GPS position.
  const point = {
    latitude: pos.latitude + deg(best.y / R),
    longitude: pos.longitude + deg(best.x / (R * Math.cos(rad(pos.latitude)))),
  };
  return { distance: best.distance, segment: best.segment, remaining, point };
}

/**
 * GPS fix filter + smoothing.
 *  - drops fixes with poor accuracy (> maxAccuracy m)
 *  - drops physically impossible jumps (> maxSpeed m/s)
 *  - smooths by accuracy-weighted averaging with the previous estimate
 */
export class GpsFilter {
  constructor({ maxAccuracy = 30, maxSpeed = 12, maxAgeMs = 20000, now = () => Date.now() } = {}) {
    this.maxAccuracy = maxAccuracy;
    this.maxSpeed = maxSpeed;
    this.maxAgeMs = maxAgeMs;
    this.now = now;
    this.last = null;
  }
  reset() { this.last = null; }
  accept(fix) {
    const { latitude, longitude } = fix;
    const accuracy = Number.isFinite(fix.accuracy) ? fix.accuracy : this.maxAccuracy;
    const time = Number.isFinite(fix.timestamp) ? fix.timestamp : this.now();
    if (![latitude, longitude].every(Number.isFinite)) return { ok: false, reason: 'invalid' };
    if (accuracy > this.maxAccuracy) return { ok: false, reason: 'low_accuracy' };
    if (Math.abs(this.now() - time) > this.maxAgeMs) return { ok: false, reason: 'stale' };
    if (this.last) {
      if (time < this.last.time) return { ok: false, reason: 'stale' };
      const dt = Math.max((time - this.last.time) / 1000, 0.001);
      if (haversine(this.last, { latitude, longitude }) / dt > this.maxSpeed) return { ok: false, reason: 'jump' };
      const wOld = 1 / (this.last.accuracy ** 2), wNew = 1 / (accuracy ** 2);
      const k = wNew / (wOld + wNew);
      const sm = { latitude: this.last.latitude + k * (latitude - this.last.latitude), longitude: this.last.longitude + k * (longitude - this.last.longitude) };
      this.last = { ...sm, accuracy: Math.min(accuracy, this.last.accuracy + 1), time };
    } else this.last = { latitude, longitude, accuracy, time };
    return { ok: true, position: { latitude: this.last.latitude, longitude: this.last.longitude }, accuracy };
  }
}

/** Split a recorded polyline wherever a signal gap was explicitly marked. */
export function splitAtGaps(points = [], gaps = []) {
  if (!points.length) return [];
  const breaks = new Set(gaps.filter((n) => Number.isInteger(n) && n >= 0 && n < points.length - 1));
  const parts = [];
  let current = [];
  points.forEach((p, i) => {
    current.push(p);
    if (breaks.has(i)) { parts.push(current); current = []; }
  });
  if (current.length) parts.push(current);
  return parts;
}

/**
 * Split a saved route where the recorded timestamps jump by more than `maxGapMs`.
 * Published routes only carry points, so the timestamp gap is the durable evidence of an
 * interruption; drawing through it would silently imply the segment was walked.
 */
export function splitAtTimeGaps(points = [], maxGapMs = GAP_AFTER_MS) {
  if (!points.length) return [];
  const parts = [];
  let current = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const before = Date.parse(points[i - 1]?.recordedAt);
    const after = Date.parse(points[i]?.recordedAt);
    if (Number.isFinite(before) && Number.isFinite(after) && after - before > maxGapMs) {
      parts.push(current);
      current = [points[i]];
    } else current.push(points[i]);
  }
  parts.push(current);
  return parts;
}

export const formatDistance = (m) => {
  if (m == null || !Number.isFinite(m)) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
};

/** Walking estimate at 80 m/min. */
export const formatWalkTime = (m) => {
  if (m == null || !Number.isFinite(m)) return '';
  const mins = Math.round(m / 80);
  if (mins < 1) return '<1 min';
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `~${mins} min`;
};

export const formatDuration = (ms) => {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

export const isSecureContextOk = () =>
  typeof window !== 'undefined' && (window.isSecureContext || window.location.hostname === 'localhost');
