import { useEffect, useId, useMemo, useState } from "react";
import { adminApi, items, normLocation } from "../adminApi";
import { useAdminAuth } from "../AuthContext";
import { capturePosition, MAX_ACCURACY_M } from "../geo";
import { errorMessage, fmtMeters, isConflict } from "../adminUtils";
import { Field, Status, styles } from "../ui";
import MapPicker from "./MapPicker";
import ImageUpload from "./ImageUpload";

const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));
// Register (location = null) or edit/correct a location.
export default function LocationForm({ location, others = [], onSaved, onCancel }) {
  const { onApiError } = useAdminAuth(), ids = [useId(), useId(), useId(), useId()];
  const [loc, setLoc] = useState(location);
  const [f, setF] = useState(() => init(location));
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState({ kind: "", text: "" }), [errors, setErrors] = useState({});
  const [nearby, setNearby] = useState(null), [conflict, setConflict] = useState(false);
  const lat = num(f.latitude), lng = num(f.longitude);
  const pos = !isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  const mapOthers = useMemo(() => others.filter((o) => !loc || o.id !== loc.id), [others, loc]);
  useEffect(() => { setF(init(loc)); }, [loc]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const setPos = ({ lat: a, lng: b }) => { setF((s) => ({ ...s, latitude: a.toFixed(7), longitude: b.toFixed(7) })); setNearby(null); };

  function fail(err, extra) { if (onApiError(err)) return; setMsg({ kind: "bad", text: errorMessage(err) }); if (extra) extra(); }
  async function checkNearby(p = pos) {
    if (!p) return setMsg({ kind: "bad", text: "Set a position first." });
    try {
      const list = items(await adminApi.nearbyLocations(p.lat, p.lng)).filter((x) => !loc || x.id !== loc.id);
      setNearby(list); setMsg(list.length ? { kind: "bad", text: "A location is already registered nearby." } : { kind: "ok", text: "Nothing is registered nearby." });
    } catch (err) { fail(err); }
  }
  async function gps() {
    setMsg({ kind: "", text: "Getting your GPS position…" });
    try {
      const c = await capturePosition();
      setPos({ lat: c.latitude, lng: c.longitude });
      setMsg({ kind: c.accuracy > MAX_ACCURACY_M ? "bad" : "ok", text: `Position captured (±${Math.round(c.accuracy)} m).${c.accuracy > MAX_ACCURACY_M ? " Accuracy is weak: wait for a better signal, or drag the marker to the correct spot." : " Drag the marker to correct it if needed."}` });
      if (!loc) checkNearby({ lat: c.latitude, lng: c.longitude });
    } catch (err) { setMsg({ kind: "bad", text: err.message }); }
  }
  function validate() {
    const e = {};
    if (!f.name.trim()) e.name = "Enter a name.";
    if (isNaN(lat) || lat < -90 || lat > 90) e.latitude = "Latitude must be between -90 and 90.";
    if (isNaN(lng) || lng < -180 || lng > 180) e.longitude = "Longitude must be between -180 and 180.";
    setErrors(e); return Object.keys(e).length === 0;
  }
  async function save(confirmNearby = false) {
    if (!validate()) return;
    setBusy(true); setMsg({ kind: "", text: "Saving…" }); setConflict(false);
    const body = { name: f.name.trim(), description: f.description.trim(), latitude: lat, longitude: lng, imageUrl: f.imageUrl || null };
    try {
      if (loc) await adminApi.updateLocation(loc.id, { ...body, expectedVersion: loc.versionNumber });
      else await adminApi.createLocation(confirmNearby ? { ...body, confirmNearby: true } : body);
      onSaved(loc ? "Location updated." : "Location registered.");
    } catch (err) {
      if (err.code === "NEARBY_LOCATION") { setNearby(items(err.details && err.details.nearby)); setMsg({ kind: "bad", text: "A location is already registered nearby." }); }
      else if (err.code === "DUPLICATE_NAME") { setErrors({ name: "An active location already has this name." }); setMsg({ kind: "bad", text: "An active location already has this name." }); }
      else if (isConflict(err)) { setConflict(true); setMsg({ kind: "bad", text: errorMessage(err) }); }
      else fail(err);
    } finally { setBusy(false); }
  }
  async function reload() {
    try { const fresh = normLocation(await adminApi.getLocation(loc.id)); setLoc(fresh); setConflict(false); setMsg({ kind: "ok", text: "Reloaded the latest version. Re-apply your changes." }); } catch (err) { fail(err); }
  }
  return (
    <form className={styles.card} onSubmit={(e) => { e.preventDefault(); save(false); }} noValidate>
      <h3>{loc ? "Edit location" : "Register location"}</h3>
      <Field label="Name" htmlFor={ids[0]} error={errors.name}><input id={ids[0]} maxLength={120} value={f.name} onChange={set("name")} required /></Field>
      <Field label="Description" htmlFor={ids[1]}><textarea id={ids[1]} rows={3} maxLength={2000} value={f.description} onChange={set("description")} /></Field>
      <div className={styles.row}>
        <Field label="Latitude" htmlFor={ids[2]} error={errors.latitude}><input id={ids[2]} inputMode="decimal" value={f.latitude} onChange={set("latitude")} /></Field>
        <Field label="Longitude" htmlFor={ids[3]} error={errors.longitude}><input id={ids[3]} inputMode="decimal" value={f.longitude} onChange={set("longitude")} /></Field>
      </div>
      <div className={styles.row}><button type="button" onClick={gps}>Capture my GPS position</button><button type="button" onClick={() => checkNearby()}>Check nearby</button></div>
      <MapPicker value={pos} onChange={setPos} others={mapOthers} />
      {nearby && nearby.length > 0 && (
        <div className={styles.card} role="alert">
          <strong>Already registered nearby:</strong>
          <ul className={styles.list}>{nearby.map((n) => <li key={n.id}><span>{n.name}{n.status === "inactive" ? " (inactive)" : ""}</span><span className={styles.muted}>{typeof n.distanceMeters === "number" ? fmtMeters(n.distanceMeters) : ""}</span></li>)}</ul>
          {!loc && <><p>Register anyway?</p><button type="button" className={styles.primary} disabled={busy} onClick={() => save(true)}>Yes, register anyway</button></>}
        </div>
      )}
      <ImageUpload value={f.imageUrl} onChange={(url) => setF((s) => ({ ...s, imageUrl: url }))} />
      <div className={styles.row} style={{ marginTop: 12 }}>
        <button className={styles.primary} disabled={busy}>{busy ? "Saving…" : "Save"}</button><button type="button" onClick={onCancel}>Cancel</button>
      </div>
      <Status kind={msg.kind || undefined}>{msg.text}</Status>
      {conflict && <button type="button" onClick={reload}>Reload latest version</button>}
    </form>
  );
}
function init(l) { return { name: l ? l.name : "", description: l ? l.description || "" : "", latitude: l ? String(l.latitude) : "", longitude: l ? String(l.longitude) : "", imageUrl: l ? l.imageUrl : null }; }
