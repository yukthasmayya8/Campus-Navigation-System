/** Pure geo helpers for navigation (no DOM, unit-tested). Distances in metres. */
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

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
 * Distance from `pos` to the polyline, the nearest segment index, and metres left to walk
 * from the projected position to the end of the path.
 */
export function locateOnPath(pos, points) {
  if (!points.length) return { distance: Infinity, segment: -1, remaining: 0 };
  if (points.length === 1) return { distance: haversine(pos, points[0]), segment: 0, remaining: 0 };
  const P = project(pos, pos);
  let best = { distance: Infinity, segment: 0, t: 0 };
  for (let i = 0; i < points.length - 1; i++) {
    const a = project(points[i], pos), b = project(points[i + 1], pos);
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((P.x - a.x) * dx + (P.y - a.y) * dy) / len2));
    const d = Math.hypot(a.x + t * dx - P.x, a.y + t * dy - P.y);
    if (d < best.distance) best = { distance: d, segment: i, t };
  }
  const segLen = haversine(points[best.segment], points[best.segment + 1]);
  let remaining = segLen * (1 - best.t);
  for (let i = best.segment + 1; i < points.length - 1; i++) remaining += haversine(points[i], points[i + 1]);
  return { distance: best.distance, segment: best.segment, remaining };
}

/**
 * GPS fix filter + smoothing.
 *  - drops fixes with poor accuracy (> maxAccuracy m)
 *  - drops physically impossible jumps (> maxSpeed m/s)
 *  - smooths by accuracy-weighted averaging with the previous estimate
 */
export class GpsFilter {
  constructor({ maxAccuracy = 30, maxSpeed = 12 } = {}) { this.maxAccuracy = maxAccuracy; this.maxSpeed = maxSpeed; this.last = null; }
  reset() { this.last = null; }
  accept(fix) {
    const { latitude, longitude } = fix;
    const accuracy = Number.isFinite(fix.accuracy) ? fix.accuracy : this.maxAccuracy;
    const time = fix.timestamp ?? Date.now();
    if (![latitude, longitude].every(Number.isFinite)) return { ok: false, reason: 'invalid' };
    if (accuracy > this.maxAccuracy) return { ok: false, reason: 'low_accuracy' };
    if (this.last) {
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
