import { GpsFilter, locateOnPath, pathLength } from './geo.js';
import { GPS_THRESHOLDS } from './gpsThresholds.js';

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
  constructor(points, { segments, offPathMeters = GPS_THRESHOLDS.offPathBaseM, offPathFixes = 3, arrivalMeters = GPS_THRESHOLDS.arrivalBaseM, maxCandidateDistanceM = GPS_THRESHOLDS.matchCandidateDistanceM } = {}) {
    this.points = points || [];
    this.segments = asSegments(this.points, segments);
    this.opts = { offPathMeters, offPathFixes, arrivalMeters, maxCandidateDistanceM };
    this.strikes = 0;
    this.arrived = false;
    this.lastMatch = null; // previous map-matched segment/projection, used for continuity.

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

    const accuracy = accepted.accuracy;
    // GPS accuracy widens the acceptable corridor around a route. A noisy fix must not
    // be treated as off-route merely because it falls outside the base threshold.
    // Accuracy is an estimate, so the safety factor is deliberately conservative.
    const matchThreshold = Math.max(this.opts.offPathMeters, accuracy * GPS_THRESHOLDS.accuracySafetyFactor);
    const candidates = [];
    this.segments.forEach((segment, segmentIndex) => {
      if (!segment.length) return;
      const loc = locateOnPath(accepted.position, segment);
      if (!Number.isFinite(loc.distance)) return;
      candidates.push({
        distance: loc.distance,
        score: loc.distance,
        segment: (this.offsets[segmentIndex] || 0) + Math.max(0, loc.segment || 0),
        segmentIndex,
        segmentPoint: loc.segment || 0,
        remaining: loc.remaining + (this.suffix[segmentIndex + 1] || 0),
        projected: loc.point,
        t: loc.segment || 0,
      });
    });
    if (!candidates.length) return { ok: false, reason: 'no_path' };

    const valid = candidates.filter((c) => c.distance <= Math.max(this.opts.maxCandidateDistanceM, matchThreshold * 2));
    const pool = valid.length ? valid : candidates;
    const nearest = pool.slice().sort((a, b) => a.distance - b.distance)[0];

    // Segment hysteresis: a tiny distance advantage on an adjacent segment is not enough
    // to abandon the current map-matched segment. The user must be clearly closer or the
    // current segment must no longer be a plausible candidate.
    let best = nearest;
    if (this.lastMatch) {
      const current = pool.find((c) => c.segmentIndex === this.lastMatch.segmentIndex);
      if (current && current.distance <= nearest.distance + GPS_THRESHOLDS.segmentSwitchMarginM
          && current.distance <= matchThreshold) {
        best = current;
      }
    }

    this.lastMatch = {
      segmentIndex: best.segmentIndex,
      segmentPoint: best.segmentPoint,
      projected: best.projected,
      timestamp: Number.isFinite(fix.timestamp) ? fix.timestamp : Date.now(),
      distance: best.distance,
    };

    this.strikes = best.distance > matchThreshold ? this.strikes + 1 : 0;
    const onLastSegment = best.segmentIndex === this.segments.length - 1;
    if (onLastSegment && best.remaining <= this.opts.arrivalMeters + GPS_THRESHOLDS.arrivalAccuracyAllowanceM
        && best.distance <= this.opts.arrivalMeters + GPS_THRESHOLDS.arrivalAccuracyAllowanceM) {
      this.arrived = true;
    }
    const matchConfidence = best.distance <= accuracy ? 'high'
      : best.distance <= Math.max(this.opts.offPathMeters, accuracy * 2) ? 'moderate' : 'low';

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
      matchConfidence,
    };
  }
}
