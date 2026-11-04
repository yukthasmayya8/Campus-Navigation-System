/** Pure geo/route helpers (no I/O) so they can be unit-tested. */

const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);
const validLat = (n) => isFiniteNum(n) && n >= -90 && n <= 90;
const validLng = (n) => isFiniteNum(n) && n >= -180 && n <= 180;

/** Escape LIKE wildcards so user input is matched literally. */
const escapeLike = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);

/**
 * Reverse a route for a verified bidirectional reverse match.
 * Points and waypoints are returned in reversed order with sequence numbers
 * renumbered 1..n; endpoints swapped; flagged reversed. Nothing is persisted.
 */
function reverseRoute(route) {
  const points = [...route.points].reverse().map((p, i) => ({ ...p, sequenceNumber: i + 1 }));
  const waypoints = [...route.waypoints].reverse().map((w, i) => ({ ...w, sequenceNumber: i + 1 }));
  return {
    ...route,
    sourceLocationId: route.destinationLocationId,
    destinationLocationId: route.sourceLocationId,
    points,
    waypoints,
    reversed: true,
  };
}

/** Default deterministic ordering (unknown/NULL is never treated as false). */
function compareRoutes(a, b) {
  const rank = (v, want) => (v === want ? 0 : 1);
  return (
    rank(a.hasStairs, false) - rank(b.hasStairs, false) ||
    rank(a.hasRamp, true) - rank(b.hasRamp, true) ||
    rank(a.isCovered, true) - rank(b.isCovered, true) ||
    a.routeId - b.routeId
  );
}

/** Shallow field diff between two snapshots. Arrays/objects compared by JSON. */
function diffSnapshots(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const changes = [];
  for (const k of keys) {
    const av = a ? a[k] : undefined;
    const bv = b ? b[k] : undefined;
    if (JSON.stringify(av) !== JSON.stringify(bv)) {
      if (k === 'points') changes.push({ field: k, from: { count: (av || []).length }, to: { count: (bv || []).length } });
      else changes.push({ field: k, from: av ?? null, to: bv ?? null });
    }
  }
  return changes;
}

module.exports = { validLat, validLng, escapeLike, reverseRoute, compareRoutes, diffSnapshots };
