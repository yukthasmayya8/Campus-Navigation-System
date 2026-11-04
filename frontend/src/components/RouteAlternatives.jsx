// null means "not verified" - it must never be displayed as "No".
const tri = (v) => (v === true ? 'Yes' : v === false ? 'No' : 'Not verified');
const cls = (v) => (v === null || v === undefined ? 'unverified' : v ? 'yes' : 'no');

export default function RouteAlternatives({ routes, selectedId, onSelect }) {
  return (
    <ul className="alts">
      {routes.map((r, i) => (
        <li key={`${r.routeId}-${r.reversed}`}>
          <button className={`alt ${selectedId === r.routeId ? 'selected' : ''}`} onClick={() => onSelect(r)}>
            <strong>{r.routeName || `Route ${i + 1}`}</strong>
            {r.reversed && <span className="tag">Reverse direction</span>}
            {r.distanceMeters != null && <span className="dist">≈ {r.distanceMeters} m</span>}
            <div className="chars">
              {[['Stairs', r.hasStairs], ['Ramp', r.hasRamp], ['Covered walkway', r.isCovered]].map(([label, v]) => (
                <span key={label} className={`chip ${cls(v)}`}>{label}: {tri(v)}</span>
              ))}
            </div>
            {r.waypoints.length > 0 && (
              <div className="via">Via: {r.waypoints.map((w) => w.name).join(' → ')}</div>
            )}
            {r.notes && <div className="via">{r.notes}</div>}
          </button>
        </li>
      ))}
    </ul>
  );
}
