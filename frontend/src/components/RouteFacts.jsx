import { formatDistance, formatWalkTime, segmentsLength, splitAtTimeGaps } from '../lib/geo.js';

/** Walkable pieces of a route. Saved gaps are breaks in evidence, not walked line. */
export function routeSegments(route) {
  if (Array.isArray(route?.segments) && route.segments.length) return route.segments;
  return splitAtTimeGaps(route?.points || []);
}

/**
 * Approximate walked metres. Recorded GPS is not survey-grade, and any gap jump is excluded.
 * Falls back to the server-provided distance when only an admin summary (no points) is loaded.
 */
export function routeMeters(route) {
  const segments = routeSegments(route);
  const walked = segmentsLength(segments);
  if (walked > 0 && (route?.points?.length || 0) > 1) return walked;
  return route?.distanceMeters ?? (walked || null);
}

export function routeGapCount(route) {
  return Math.max(0, routeSegments(route).length - 1);
}

function TriChip({ value, yes, no, unknown, tone = 'green' }) {
  if (value === true) return <span className={`chip ${tone === 'green' ? 'green' : 'red'}`}>{yes}</span>;
  if (value === false) return no ? <span className="chip green">{no}</span> : null;
  return unknown ? <span className="chip amber">{unknown}</span> : null;
}

/**
 * Compact, repeated route facts used by both public route cards and the admin preview.
 * `detailed` adds "not verified" chips; cards stay short by showing only useful positives.
 */
export default function RouteFacts({ route, showDistance = true, detailed = false }) {
  const meters = routeMeters(route);
  const gaps = routeGapCount(route);
  return (
    <>
      {showDistance && (
        <div className="route-card-meta">
          {meters != null && <span title="Approximate distance from recorded GPS">📏 ≈ {formatDistance(meters)}</span>}
          {meters != null && <span>🚶 {formatWalkTime(meters)}</span>}
          {gaps > 0 && (
            <span className="route-meta-warn" title="The recorded line is intentionally broken at each GPS gap">
              ⚠ {gaps} GPS gap{gaps > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
      <div className="route-chips">
        <TriChip
          value={route?.hasStairs}
          yes="Stairs"
          no="Step-free"
          unknown={detailed ? 'Stairs not verified' : null}
          tone="red"
        />
        <TriChip
          value={route?.hasRamp}
          yes="Ramp"
          no={detailed ? 'No ramp' : ''}
          unknown={detailed ? 'Ramp not verified' : null}
        />
        <TriChip
          value={route?.isCovered}
          yes="Covered"
          no={detailed ? 'Open air' : ''}
          unknown={detailed ? 'Cover not verified' : null}
        />
        {route?.waypoints?.length > 0 && (
          <span className="chip blue">Via {route.waypoints.length} stop{route.waypoints.length > 1 ? 's' : ''}</span>
        )}
        {route?.reversed && <span className="chip amber">Reverse</span>}
      </div>
    </>
  );
}
