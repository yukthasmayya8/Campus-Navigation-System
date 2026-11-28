import { useState } from 'react';
import { buildGpsDiagnostics, formatDiagnosticsText } from '../lib/gpsDiagnostics.js';

const NA = 'N/A';

function value(v) {
  if (v === null || v === undefined || v === '') return NA;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NA;
  return String(v);
}

export default function GpsDiagnosticsPanel({ rawGps, filteredGps, gpsState, gpsGoodStreak, permissionState,
  filterAccepted, filterReason, navInfo, tracker, selectedRoute, currentBuilding, destination, now }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const snapshot = buildGpsDiagnostics({
    rawGps, filteredGps, gpsState, gpsGoodStreak, permissionState, filterAccepted, filterReason,
    navInfo, tracker, selectedRoute, currentBuilding, destination, now,
  });

  async function copy() {
    const text = formatDiagnosticsText(snapshot);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="stack sm" style={{ border: '1px solid var(--border, #ddd)', borderRadius: 12, padding: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>GPS Diagnostics (developer)</strong>
        <div className="row tight">
          <button type="button" onClick={copy} style={{ width: 'auto', fontSize: 12 }}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" onClick={() => setOpen((v) => !v)} style={{ width: 'auto', fontSize: 12 }}>
            {open ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      {open && (
        <div style={{ fontSize: 12, lineHeight: 1.45 }}>
          <h4>Raw GPS</h4>
          <div>Latitude: {value(snapshot.raw.latitude)}</div>
          <div>Longitude: {value(snapshot.raw.longitude)}</div>
          <div>Accuracy: {snapshot.raw.accuracyM == null ? NA : `${snapshot.raw.accuracyM.toFixed(1)} m`}</div>
          <div>Timestamp: {snapshot.raw.timestamp ? new Date(snapshot.raw.timestamp).toISOString() : NA}</div>
          <div>Age: {snapshot.raw.ageMs == null ? NA : `${snapshot.raw.ageMs} ms`}</div>
          <div>Availability: {value(snapshot.raw.availability)}</div>

          <h4>Filtered GPS</h4>
          <div>Latitude: {value(snapshot.filtered.latitude)}</div>
          <div>Longitude: {value(snapshot.filtered.longitude)}</div>
          <div>Raw-to-filtered distance: {snapshot.filtered.distanceFromRawM == null ? NA : `${snapshot.filtered.distanceFromRawM.toFixed(1)} m`}</div>

          <h4>Filter</h4>
          <div>Accepted: {snapshot.filter.accepted == null ? NA : snapshot.filter.accepted ? 'yes' : 'no'}</div>
          <div>Reason: {value(snapshot.filter.reason)}</div>

          <h4>Confidence</h4>
          <div>State: {snapshot.confidence.state}</div>
          <div>Recovery fixes: {snapshot.confidence.recoveryFixes}</div>
          <div>Suitable for navigation: {snapshot.confidence.suitableForNavigation ? 'yes' : 'no'}</div>

          <h4>Route matching</h4>
          <div>Route ID: {value(snapshot.routeMatching.routeId)}</div>
          <div>Segment: {value(snapshot.routeMatching.segmentIndex)}</div>
          <div>Distance to segment: {snapshot.routeMatching.distanceToSegmentM == null ? NA : `${snapshot.routeMatching.distanceToSegmentM} m`}</div>
          <div>Remaining route: {snapshot.routeMatching.remainingRouteM == null ? NA : `${snapshot.routeMatching.remainingRouteM} m`}</div>
          <div>Map matching: {snapshot.routeMatching.mapMatchingState}</div>
          <div>Off-route counter: {snapshot.routeMatching.offRouteCounter ?? NA}/{snapshot.routeMatching.offRouteThreshold}</div>
          <div>On route: {snapshot.routeMatching.onRoute == null ? NA : snapshot.routeMatching.onRoute ? 'yes' : 'no'}</div>

          <h4>Building detection</h4>
          <div>Suggested: {value(snapshot.building.suggested)}</div>
          <div>Second candidate: {value(snapshot.building.secondCandidate)}</div>
          <div>Distance to nearest reference: {snapshot.building.distanceToNearestReferenceM == null ? NA : `${snapshot.building.distanceToNearestReferenceM} m`}</div>
          <div>Ambiguity state: {snapshot.building.ambiguityState}</div>
          <div>Reason: {value(snapshot.building.reason)}</div>
          <div>Approximate: {snapshot.building.approximate ? 'yes' : 'no'}</div>
          <div>Verified boundary: {snapshot.building.verifiedBoundary ? 'yes' : 'no'}</div>

          <h4>Arrival</h4>
          <div>Arrived: {snapshot.arrival.arrived ? 'yes' : 'no'}</div>
          <div>Distance to destination: {snapshot.arrival.distanceToDestinationM == null ? NA : `${snapshot.arrival.distanceToDestinationM.toFixed(1)} m`}</div>
          <div>Arrival threshold: {snapshot.arrival.arrivalThresholdM} m</div>
          <div>Confirmed: {snapshot.arrival.confirmed ? 'yes' : 'no'}</div>
        </div>
      )}
    </section>
  );
}
