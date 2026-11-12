// Client copy of the backend's reverse-match + sort rules, used when working from the offline cache.
export function reverseRoute(r) {
  const renum = (a) => [...a].reverse().map((x, i) => ({ ...x, sequenceNumber: i + 1 }));
  return { ...r, sourceLocationId: r.destinationLocationId, destinationLocationId: r.sourceLocationId,
    points: renum(r.points || []), waypoints: renum(r.waypoints || []), reversed: true };
}
const rank = (v, want) => (v === want ? 0 : 1);
export const compareRoutes = (a, b) =>
  rank(a.hasStairs, false) - rank(b.hasStairs, false) || rank(a.hasRamp, true) - rank(b.hasRamp, true) ||
  rank(a.isCovered, true) - rank(b.isCovered, true) || a.routeId - b.routeId;

const sameId = (a, b) => String(a) === String(b);

export function alternativesFrom(routes, fromId, toId) {
  if (!Array.isArray(routes) || sameId(fromId, toId)) return [];
  return routes
    .filter((r) => r && r.sourceLocationId != null && r.destinationLocationId != null &&
      ((sameId(r.sourceLocationId, fromId) && sameId(r.destinationLocationId, toId)) ||
        (sameId(r.sourceLocationId, toId) && sameId(r.destinationLocationId, fromId) && r.directionality === 'bidirectional')))
    .map((r) => (sameId(r.sourceLocationId, fromId) ? r : reverseRoute(r))).sort(compareRoutes);
}
