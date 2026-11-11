import { useId, useState } from "react";
import { styles } from "../ui";

// Ordered waypoints: only registered, ACTIVE locations other than the start and destination can be added.
export default function WaypointSelector({ locations, sourceId, destinationId, value, onChange, disabled }) {
  const id = useId();
  const options = locations.filter((l) => l.status === "active" && l.id !== Number(sourceId) && l.id !== Number(destinationId));
  const [pick, setPick] = useState("");
  const name = (i) => { const l = locations.find((x) => x.id === i); return l ? l.name + (l.status === "inactive" ? " (inactive)" : "") : `#${i}`; };
  const move = (i, d) => { const a = value.slice(), j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; onChange(a); };
  return (
    <div>
      <h2>Waypoints (in walking order)</h2>
      {value.length === 0 ? <p className={styles.muted}>No waypoints marked.</p> : (
        <ol className={styles.list} aria-label="Waypoints">
          {value.map((w, i) => (
            <li key={`${w}-${i}`}><span>{i + 1}. {name(w)}</span>
              <span className={styles.row}>
                <button type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${name(w)} up`}>↑</button>
                <button type="button" disabled={disabled || i === value.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${name(w)} down`}>↓</button>
                <button type="button" disabled={disabled} onClick={() => onChange(value.filter((_, k) => k !== i))} aria-label={`Remove ${name(w)}`}>Remove</button>
              </span></li>
          ))}
        </ol>
      )}
      <div className={styles.row} style={{ marginTop: 8 }}>
        <select id={id} aria-label="Waypoint to add" value={pick} disabled={disabled} onChange={(e) => setPick(e.target.value)}>
          <option value="">Choose a registered building</option>{options.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <button type="button" disabled={disabled || !pick} onClick={() => { const n = Number(pick); if (value[value.length - 1] !== n) onChange([...value, n]); setPick(""); }}>Add waypoint</button>
      </div>
    </div>
  );
}
