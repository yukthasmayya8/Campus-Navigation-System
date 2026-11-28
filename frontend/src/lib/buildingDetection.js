/**
 * Building detection and navigation-source separation.
 *
 * This module deliberately keeps five different things apart:
 *   - the raw GPS position and its reported accuracy,
 *   - the current building (verified only when a verified boundary exists),
 *   - a building's stored reference coordinate,
 *   - the user-selected navigation source,
 *   - the user-selected destination.
 *
 * The current campus data has no verified boundary polygons. In that case this module
 * returns a clearly labelled *approximate* suggestion; it never claims that the user is
 * inside a building just because a reference coordinate is nearest.
 */
import { haversine } from './geo.js';

export const DETECTION_LIMITS = Object.freeze({
  /** Above this reported accuracy no building claim is made. */
  maxAccuracyM: 40,
  /** Beyond this distance from a reference coordinate, no approximate suggestion is made. */
  maxSuggestionDistanceM: 80,
  /** Accuracy needed before a verified boundary can be claimed. */
  boundaryAccuracyM: 30,
  /** A fix older than this is not used for building detection. */
  staleMs: 15000,
  /** Keep the previous building unless a new one is at least this much closer. */
  hysteresisM: 15,
  /** A competing building must win this many consecutive fixes before switching. */
  switchFixes: 3,
  /** First/second reference distances closer than this mean "between buildings". */
  ambiguousGapM: 12,
});

const hasCoordinate = (p) => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
  && p.latitude >= -90 && p.latitude <= 90 && p.longitude >= -180 && p.longitude <= 180;

function asPoint(value, geojson = false) {
  if (value && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)) {
    return { latitude: value.latitude, longitude: value.longitude };
  }
  if (Array.isArray(value) && value.length >= 2 && value.every(Number.isFinite)) {
    // GeoJSON uses [longitude, latitude]; our own explicit boundary format uses [latitude, longitude].
    return geojson
      ? { latitude: value[1], longitude: value[0] }
      : { latitude: value[0], longitude: value[1] };
  }
  return null;
}

/** Extract rings only from explicitly supplied boundary data. Never synthesised. */
function ringsFor(location) {
  const boundary = location?.boundary ?? location?.boundaryGeometry ?? location?.verifiedBoundary;
  if (!boundary) return [];
  let rings = null;
  if (boundary.type === 'Polygon' && Array.isArray(boundary.coordinates)) {
    rings = boundary.coordinates.map((ring) => (Array.isArray(ring) ? ring.map((p) => asPoint(p, true)) : []));
  } else if (Array.isArray(boundary)) {
    const first = boundary[0];
    if (Array.isArray(first) || (first && Number.isFinite(first.latitude))) {
      rings = [boundary.map((p) => asPoint(p))];
    } else if (first && Array.isArray(first.coordinates)) {
      rings = first.coordinates.map((ring) => (Array.isArray(ring) ? ring.map((p) => asPoint(p, true)) : []));
    }
  }
  return (rings || []).map((ring) => ring.filter(Boolean)).filter((ring) => ring.length >= 3);
}

/** Ray-casting point-in-polygon test for a single ring of {latitude, longitude}. */
export function pointInRing(point, ring) {
  if (!hasCoordinate(point) || !Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const xi = a.longitude, yi = a.latitude, xj = b.longitude, yj = b.latitude;
    const intersects = ((yi > point.latitude) !== (yj > point.latitude))
      && (point.longitude < ((xj - xi) * (point.latitude - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Returns true, false, or null when no verified boundary is available. */
export function pointInVerifiedBoundary(point, location) {
  const rings = ringsFor(location);
  if (!rings.length) return null;
  if (!pointInRing(point, rings[0])) return false;
  return !rings.slice(1).some((hole) => pointInRing(point, hole));
}

const unavailable = (reason) => ({
  status: 'unavailable', buildingId: null, buildingName: null,
  distanceMeters: null, accuracyMeters: null, confidence: 'none',
  source: null, explanation: reason, alternatives: [], candidates: [],
  observedAt: new Date().toISOString(), streak: 0, pendingId: null, pendingStreak: 0,
});

/**
 * Resolve a building observation from one GPS fix.
 * A verified boundary wins; otherwise the result is an explicitly approximate suggestion.
 */
export function resolveBuilding(position, buildings = [], options = {}) {
  const cfg = { ...DETECTION_LIMITS, ...options };
  if (!hasCoordinate(position)) return unavailable('Invalid GPS coordinates.');
  const accuracy = position.accuracy;
  if (!Number.isFinite(accuracy)) return unavailable('GPS accuracy was not reported; cannot identify a building.');
  if (accuracy > cfg.maxAccuracyM) {
    return unavailable(`GPS accuracy is about ${Math.round(accuracy)} m, too coarse to identify a building. Move outdoors or wait for a better fix.`);
  }
  const now = typeof cfg.now === 'function' ? cfg.now() : Date.now();
  if (Number.isFinite(position.timestamp) && Math.abs(now - position.timestamp) > cfg.staleMs) {
    return unavailable('This GPS fix is stale. Waiting for a fresh position.');
  }

  const candidates = [];
  for (const building of buildings) {
    if (!hasCoordinate(building)) continue;
    const inside = pointInVerifiedBoundary(position, building);
    candidates.push({
      id: building.locationId,
      name: building.name,
      distance: haversine(position, building),
      inside,
      location: building,
    });
  }
  const observedAt = new Date().toISOString();

  const insideCandidates = candidates.filter((c) => c.inside === true);
  if (insideCandidates.length && accuracy <= cfg.boundaryAccuracyM) {
    insideCandidates.sort((a, b) => a.distance - b.distance);
    const hit = insideCandidates[0];
    return {
      status: 'inside', buildingId: hit.id, buildingName: hit.name,
      distanceMeters: Math.round(hit.distance), accuracyMeters: Math.round(accuracy),
      confidence: 'high', source: 'verified_boundary',
      explanation: `Inside the verified boundary of ${hit.name}.`,
      alternatives: insideCandidates.slice(1).map((c) => ({ id: c.id, name: c.name, distanceMeters: Math.round(c.distance) })),
      candidates, observedAt, streak: 1, pendingId: null, pendingStreak: 0,
    };
  }

  const sorted = [...candidates].sort((a, b) => a.distance - b.distance);
  const nearest = sorted[0];
  if (!nearest || nearest.distance > cfg.maxSuggestionDistanceM) {
    return {
      ...unavailable('Outside all known building areas.'), status: 'outside',
      accuracyMeters: Math.round(accuracy), candidates, observedAt,
    };
  }
  const second = sorted[1];
  const common = {
    distanceMeters: Math.round(nearest.distance),
    accuracyMeters: Math.round(accuracy),
    alternatives: sorted.slice(1, 3).map((c) => ({ id: c.id, name: c.name, distanceMeters: Math.round(c.distance) })),
    candidates, observedAt, streak: 1, pendingId: null, pendingStreak: 0,
  };

  if (second && second.distance - nearest.distance <= cfg.ambiguousGapM) {
    return {
      ...common, status: 'between', buildingId: null, buildingName: null,
      confidence: 'low', source: 'reference_coordinate',
      explanation: `Between ${nearest.name} and ${second.name} by reference coordinates; not confirmed inside either.`,
    };
  }

  const ratio = nearest.distance / Math.max(accuracy, 1);
  return {
    ...common, status: 'approximate', buildingId: nearest.id, buildingName: nearest.name,
    confidence: ratio <= 1 ? 'high' : ratio <= 2 ? 'medium' : 'low',
    source: 'reference_coordinate',
    explanation: `Approximate: ${nearest.name}'s stored reference point is ${Math.round(nearest.distance)} m from your GPS position (±${Math.round(accuracy)} m). Not confirmed inside.`,
  };
}

/**
 * Apply hysteresis so small GPS fluctuations do not flip the current building.
 * A verified boundary observation is authoritative; approximate switches need
 * `switchFixes` consecutive, clearly better fixes.
 */
export function trackBuilding(previous, current, options = {}) {
  const cfg = { ...DETECTION_LIMITS, ...options };
  if (!current || ['unavailable', 'outside', 'between'].includes(current.status)) {
    return { ...(current || unavailable('Waiting for GPS.')), streak: 0, pendingId: null, pendingStreak: 0 };
  }
  if (!previous || previous.status !== current.status || previous.buildingId == null
    || String(previous.buildingId) === String(current.buildingId)) {
    return { ...current, streak: 1, pendingId: null, pendingStreak: 0 };
  }
  if (current.status === 'inside') return { ...current, streak: 1, pendingId: null, pendingStreak: 0 };

  const previousCandidate = (current.candidates || []).find((c) => String(c.id) === String(previous.buildingId));
  const previousDistance = previousCandidate ? previousCandidate.distance : Infinity;
  const improvement = previousDistance - current.distanceMeters;
  // Consecutive-fix counting must use the tracked state: each fresh observation from
  // `resolveBuilding` starts with no pending history of its own.
  const samePending = previous.pendingId != null && String(previous.pendingId) === String(current.buildingId);
  const pendingStreak = samePending ? (previous.pendingStreak || 0) + 1 : 1;

  if (improvement >= cfg.hysteresisM && pendingStreak >= cfg.switchFixes) {
    return { ...current, streak: 1, pendingId: null, pendingStreak: 0 };
  }
  return {
    ...previous,
    distanceMeters: Math.round(previousDistance),
    accuracyMeters: current.accuracyMeters,
    observedAt: current.observedAt,
    candidates: current.candidates,
    confidence: 'low',
    explanation: `${previous.explanation} Checking a move toward ${current.buildingName} (${pendingStreak}/${cfg.switchFixes} consistent fixes).`,
    pendingId: current.buildingId,
    pendingStreak,
    streak: 0,
  };
}

/** The user's manual source always wins. A building suggestion is never a navigation source. */
export function navigationSource(manualSource, building = null) {
  return {
    source: manualSource ?? null,
    sourceKind: manualSource ? 'manual' : 'gps-point',
    buildingSuggestion: building && ['inside', 'approximate'].includes(building.status) ? building : null,
  };
}

/** UI text that never presents reference-point distance as "distance to building". */
export function formatBuildingStatus(building, limits = DETECTION_LIMITS) {
  if (!building) return { current: 'Determining current building…', reference: '', detail: '' };
  if (building.status === 'unavailable') {
    return { current: 'Current building: unknown', reference: '', detail: building.explanation };
  }
  if (building.status === 'outside') {
    return { current: 'Outside all known building areas', reference: '', detail: building.explanation };
  }
  if (building.status === 'between') {
    return { current: `Between ${building.alternatives.map((a) => a.name).join(' and ')}`, reference: '', detail: building.explanation };
  }
  const reference = Number.isFinite(building.distanceMeters) && building.distanceMeters <= limits.maxSuggestionDistanceM
    ? `Reference-point distance: ${building.distanceMeters} m (GPS ±${building.accuracyMeters} m)`
    : '';
  return {
    current: building.status === 'inside' ? `Current building: ${building.buildingName}`
      : `Current building (approximate): ${building.buildingName}`,
    reference,
    detail: building.explanation,
  };
}
