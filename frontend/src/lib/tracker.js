import { GpsFilter, locateOnPath } from './geo.js';

/**
 * Follows a recorded path: filtered position, metres remaining, off-path and arrival detection.
 * Off-path needs `offPathFixes` consecutive fixes beyond `offPathMeters` so one noisy fix never triggers it.
 */
export class PathTracker {
  constructor(points, { offPathMeters = 30, offPathFixes = 3, arrivalMeters = 15 } = {}) {
    this.points = points; this.filter = new GpsFilter(); this.opts = { offPathMeters, offPathFixes, arrivalMeters };
    this.strikes = 0; this.arrived = false;
  }
  update(fix) {
    const f = this.filter.accept(fix);
    if (!f.ok) return { ok: false, reason: f.reason };
    const loc = locateOnPath(f.position, this.points);
    this.strikes = loc.distance > this.opts.offPathMeters ? this.strikes + 1 : 0;
    if (loc.remaining <= this.opts.arrivalMeters && loc.distance <= this.opts.offPathMeters * 2) this.arrived = true;
    return { ok: true, position: f.position, accuracy: f.accuracy, distanceFromPath: Math.round(loc.distance),
      remainingMeters: Math.round(loc.remaining), offPath: this.strikes >= this.opts.offPathFixes, arrived: this.arrived };
  }
}
