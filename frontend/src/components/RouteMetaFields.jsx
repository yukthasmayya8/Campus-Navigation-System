import { useId } from "react";
import { Field, TriStateSelect } from "./ui";

// Source, destination, name, directionality, verified characteristics (Verified yes / Verified no / Not verified) and notes.
export default function RouteMetaFields({ value, onChange, locations, lockEndpoints }) {
  const ids = [useId(), useId(), useId(), useId(), useId()];
  const active = locations.filter((l) => l.status === "active");
  const opts = (current) => { const list = active.slice(); const c = locations.find((l) => l.id === Number(current)); if (c && !list.includes(c)) list.unshift(c); return list; };
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const tri = (k) => (v) => onChange({ ...value, [k]: v });
  return (
    <>
      <Field label="Source" htmlFor={ids[0]}><select id={ids[0]} value={value.sourceId} onChange={set("sourceId")} disabled={lockEndpoints}>{opts(value.sourceId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
      <Field label="Destination" htmlFor={ids[1]}><select id={ids[1]} value={value.destinationId} onChange={set("destinationId")} disabled={lockEndpoints}>{opts(value.destinationId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
      <Field label="Route name" htmlFor={ids[2]}><input id={ids[2]} maxLength={120} value={value.name} onChange={set("name")} placeholder="e.g. Via main lawn" /></Field>
      <Field label="Directionality" htmlFor={ids[3]} hint="Bidirectional means you verified that walking it in reverse is suitable.">
        <select id={ids[3]} value={value.directionality} onChange={set("directionality")}><option value="one_way">One way (source to destination only)</option><option value="bidirectional">Bidirectional (reverse travel verified)</option></select>
      </Field>
      <TriStateSelect label="Stairs" value={value.hasStairs} onChange={tri("hasStairs")} />
      <TriStateSelect label="Ramp" value={value.hasRamp} onChange={tri("hasRamp")} />
      <TriStateSelect label="Covered walkway" value={value.isCovered} onChange={tri("isCovered")} />
      <Field label="Notes" htmlFor={ids[4]}><input id={ids[4]} maxLength={2000} value={value.notes} onChange={set("notes")} /></Field>
    </>
  );
}
