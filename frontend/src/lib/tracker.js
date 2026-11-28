import { GpsFilter, locateOnPath, pathLength } from './geo.js';

const asSegments = (points = [], segments = []) => {
  const usable = Array.isArray(segments) ? segments.filter((s) => Array.isArray(s) && s.length) : [];
  if (usable.length) return usable;
  return points.length ? [points] : [];
};

/**
 * Follows a recorded path: filtered position, metres remaining, off-path and arrival detection.
 *
 * `segments` are the walkable pieces of a published route (see `splitAtTimeGaps`). A recorded
 * GPS gap is not walkable evidence, so it is never added to the remaining distance and it can
 * never make the tracker report "arrived" at the end of an earlier segment.
 *
 * Off-path needs `offPathFixes` consecutive fixes beyond `offPathMeters` so one noisy fix
 * never triggers it.
 */
export class PathTracker {
  constructor(points, { segments, offPathMeters = 30, offPathFixes = 3, arrivalMeters = 15 } = {}) {
    this.points = points || [];
    this.segments = asSegments(this.points, segments);
    this.opts = { offPathMeters, offPathFixes, arrivalMeters };
    this.strikes = 0;
    this.arrived = false;

    // Global point index of each segment's first point (keeps waypoint ordering meaningful).
    this.offsets = [];
    // suffix[i] = walkable metres in segments i..end (gap jumps excluded).
    this.suffix = new Array(this.segments.length + 1).fill(0);
    let offset = 0;
    this.segments.forEach((seg, i) => {
      this.offsets.push(offset);
      offset += seg.length;
      this.suffix[i] = 0;
    });
    for (let i = this.segments.length - 1; i >= 0; i -= 1) {
      this.suffix[i] = this.suffix[i + 1] + pathLength(this.segments[i]);
    }
  }

  update(fix) {
    if (!this.filter) this.filter = new GpsFilter();
    const accepted = this.filter.accept(fix);
    if (!accepted.ok) return { ok: false, reason: accepted.reason };

    let best = null;
    this.segments.forEach((segment, segmentIndex) => {
      if (!segment.length) return;
      const loc = locateOnPath(accepted.position, segment);
      const candidate = {
        distance: loc.distance,
        // Global point index, so "next waypoint" comparisons still use one coordinate space.
        segment: (this.offsets[segmentIndex] || 0) + Math.max(0, loc.segment || 0),
        segmentIndex,
        remaining: loc.remaining + (this.suffix[segmentIndex + 1] || 0),
        projected: loc.point,
      };
      if (!best || candidate.distance < best.distance) best = candidate;
    });
    if (!best) return { ok: false, reason: 'no_path' };

    this.strikes = best.distance > this.opts.offPathMeters ? this.strikes + 1 : 0;
    const onLastSegment = best.segmentIndex === this.segments.length - 1;
    if (onLastSegment && best.remaining <= this.opts.arrivalMeters && best.distance <= this.opts.offPathMeters * 2) {
      this.arrived = true;
    }
    return {
      ok: true,
      // `position` is the filtered device position; `projected` is its projection on the route.
      position: accepted.position,
      projected: best.projected,
      accuracy: accepted.accuracy,
      distanceFromPath: Math.round(best.distance),
      remainingMeters: Math.round(best.remaining),
      offPath: this.strikes >= this.opts.offPathFixes,
      arrived: this.arrived,
      segment: best.segment,
      segmentIndex: best.segmentIndex,
      segmentCount: this.segments.length,
    };
  }
}
