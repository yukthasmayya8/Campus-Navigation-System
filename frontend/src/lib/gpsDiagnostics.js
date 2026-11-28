import { haversine } from './geo.js';

const NA = 'N/A';

function num(value, digits = 6) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : NA;
}

function ageMs(timestamp) {
  return Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : null;
}

export function buildGpsDiagnostics(input = {}) {
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const raw = input.rawGps || null;
  const filtered = input.filteredGps || null;
  const navInfo = input.navInfo || null;
  const tracker = input.tracker || null;
  const building = input.currentBuilding || null;
  const dest = input.destination || null;

  const rawFilteredDistance = raw && filtered && Number.isFinite(raw.latitude) && Number.isFinite(filtered.latitude)
    ? haversine(raw, filtered)
    : null;

  const secondCandidate = Array.isArray(building?.alternatives) && building.alternatives.length
    ? building.alternatives[0]
    : (Array.isArray(building?.candidates)
      ? building.candidates
          .filter((c) => c.id !== building.buildingId)
          .sort((a, b) => a.distance - b.distance)[0]
      : null);

  const distanceToDestination = raw && dest && Number.isFinite(raw.latitude) && Number.isFinite(dest.latitude)
    ? haversine(raw, dest)
    : (filtered && dest && Number.isFinite(filtered.latitude) && Number.isFinite(dest.latitude)
      ? haversine(filtered, dest)
      : null);

  const arrivalThreshold = tracker?.opts?.arrivalMeters != null
    ? tracker.opts.arrivalMeters + 5
    : 15;

  const snapshot = {
    generatedAt: new Date(now).toISOString(),
    raw: {
      latitude: raw?.latitude ?? null,
      longitude: raw?.longitude ?? null,
      accuracyM: raw?.accuracy ?? null,
      timestamp: raw?.timestamp ?? null,
      ageMs: ageMs(raw?.timestamp),
      availability: input.permissionState || (raw ? 'available' : 'unavailable'),
    },
    filtered: {
      latitude: filtered?.latitude ?? null,
      longitude: filtered?.longitude ?? null,
      distanceFromRawM: rawFilteredDistance,
    },
    filter: {
      accepted: input.filterAccepted ?? null,
      reason: input.filterReason || (input.filterAccepted === false ? 'rejected' : input.filterAccepted === true ? 'accepted' : null),
    },
    confidence: {
      state: input.gpsState || 'unavailable',
      recoveryFixes: Number.isFinite(input.gpsGoodStreak) ? input.gpsGoodStreak : 0,
      suitableForNavigation: Boolean(raw && Number.isFinite(raw.accuracy) && raw.accuracy <= 30 && (ageMs(raw.timestamp) ?? Infinity) <= 20000),
    },
    routeMatching: {
      routeId: input.selectedRoute?.routeId ?? null,
      segmentIndex: navInfoSegment(navInfoSafe(input.navInfo)),
      distanceToSegmentM: finiteOrNull(input.navInfo?.distanceFromPath),
      remainingRouteM: finiteOrNull(input.navInfo?.remainingMeters),
      mapMatchingState: input.navInfo?.matchConfidence || (input.navInfo ? 'matched' : 'not_navigating'),
      offRouteCounter: finiteOrNull(tracker?.strikes),
      offRouteThreshold: tracker?.opts?.offPathFixes ?? 3,
      onRoute: input.navInfo ? !Boolean(input.navInfo.offPath) : null,
    },
    building: {
      suggested: building?.buildingName || null,
      secondCandidate: secondCandidate?.name || secondCandidate?.buildingName || null,
      distanceToNearestReferenceM: finiteOrNull(building?.distanceMeters),
      ambiguityState: building?.status || 'unavailable',
      reason: building?.explanation || null,
      approximate: building?.source === 'reference_coordinate',
      verifiedBoundary: building?.source === 'verified_boundary',
    },
    arrival: {
      arrived: input.navInfo?.arrived === true,
      distanceToDestinationM: distanceToDestination,
      arrivalThresholdM: arrivalThreshold,
      consecutiveQualifyingFixes: null,
      confirmed: input.navInfo?.arrived === true,
    },
  };

  snapshot.text = formatDiagnosticsText(snapshot);
  return snapshot;
}

function navInfoSafe(navInfo) {
  return navInfo && typeof navInfo === 'object' ? navInfo : null;
}

function navInfoSegment(navInfo) {
  if (!navInfo) return null;
  if (Number.isFinite(navInfo.segmentIndex)) return navInfo.segmentIndex;
  if (Number.isFinite(navInfo.segment)) return navInfo.segment;
  return null;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function formatDiagnosticsText(snapshot) {
  const lines = [];
  lines.push('GPS Diagnostics');
  lines.push(`Generated: ${snapshot.generatedAt}`);
  lines.push('');
  lines.push('Raw GPS:');
  lines.push(`  latitude: ${num(snapshot.raw.latitude)}`);
  lines.push(`  longitude: ${num(snapshot.raw.longitude)}`);
  lines.push(`  accuracy: ${num(snapshot.raw.accuracyM, 1)} m`);
  lines.push(`  timestamp: ${snapshot.raw.timestamp ? new Date(snapshot.raw.timestamp).toISOString() : NA}`);
  lines.push(`  age: ${snapshot.raw.ageMs == null ? NA : `${snapshot.raw.ageMs} ms`}`);
  lines.push(`  availability: ${snapshot.raw.availability || NA}`);
  lines.push('');
  lines.push('Filtered GPS:');
  lines.push(`  latitude: ${num(snapshot.filtered.latitude)}`);
  lines.push(`  longitude: ${num(snapshot.filtered.longitude)}`);
  lines.push(`  raw-to-filtered distance: ${snapshot.filtered.distanceFromRawM == null ? NA : `${snapshot.filtered.distanceFromRawM.toFixed(1)} m`}`);
  lines.push('');
  lines.push('Filter:');
  lines.push(`  accepted: ${snapshot.filter.accepted == null ? NA : snapshot.filter.accepted ? 'yes' : 'no'}`);
  lines.push(`  reason: ${snapshot.filter.reason || NA}`);
  lines.push('');
  lines.push('Confidence:');
  lines.push(`  state: ${snapshot.confidence.state}`);
  lines.push(`  recovery fixes: ${snapshot.confidence.recoveryFixes}`);
  lines.push(`  suitable for navigation: ${snapshot.confidence.suitableForNavigation ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('Route matching:');
  lines.push(`  route id: ${snapshot.routeMatching.routeId ?? NA}`);
  lines.push(`  segment: ${snapshot.routeMatching.segmentIndex ?? NA}`);
  lines.push(`  distance to segment: ${snapshot.routeMatching.distanceToSegmentM == null ? NA : `${snapshot.routeMatching.distanceToSegmentM} m`}`);
  lines.push(`  remaining route: ${snapshot.routeMatching.remainingRouteM == null ? NA : `${snapshot.routeMatching.remainingRouteM} m`}`);
  lines.push(`  map matching: ${snapshot.routeMatching.mapMatchingState}`);
  lines.push(`  off-route counter: ${snapshot.routeMatching.offRouteCounter ?? NA}/${snapshot.routeMatching.offRouteThreshold}`);
  lines.push(`  on route: ${snapshot.routeMatching.onRoute == null ? NA : snapshot.routeMatching.onRoute ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('Building detection:');
  lines.push(`  suggested: ${snapshot.building.suggested || NA}`);
  lines.push(`  second candidate: ${snapshot.building.secondCandidate || NA}`);
  lines.push(`  distance to nearest reference: ${snapshot.building.distanceToNearestReferenceM == null ? NA : `${snapshot.building.distanceToNearestReferenceM} m`}`);
  lines.push(`  ambiguity state: ${snapshot.building.ambiguityState}`);
  lines.push(`  reason: ${snapshot.building.reason || NA}`);
  lines.push(`  approximate: ${snapshot.building.approximate ? 'yes' : 'no'}`);
  lines.push(`  verified boundary: ${snapshot.building.verifiedBoundary ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('Arrival:');
  lines.push(`  arrived: ${snapshot.arrival.arrived ? 'yes' : 'no'}`);
  lines.push(`  distance to destination: ${snapshot.arrival.distanceToDestinationM == null ? NA : `${snapshot.arrival.distanceToDestinationM.toFixed(1)} m`}`);
  lines.push(`  arrival threshold: ${snapshot.arrival.arrivalThresholdM} m`);
  lines.push(`  confirmed: ${snapshot.arrival.confirmed ? 'yes' : 'no'}`);
  return lines.join('\n');
}

export const DIAGNOSTICS_NA = NA;