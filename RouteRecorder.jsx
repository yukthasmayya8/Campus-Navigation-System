import { useCallback, useEffect, useState } from "react";
import { adminApi, normRoute, routeBody } from "../adminApi";
import { useAdminAuth } from "../AuthContext";
import { useGpsRecorder } from "../useGpsRecorder";
import { useBatchUploader } from "../useBatchUploader";
import { pathLength } from "../geo";
import { errorMessage, fmtMeters, isConflict } from "../adminUtils";
import { Status, ConfirmButton, styles } from "../ui";
import RouteMetaFields from "./RouteMetaFields";
import WaypointSelector from "./WaypointSelector";
import RoutePreview from "./RoutePreview";

const toForm = (r) => ({ sourceId: r.sourceId, destinationId: r.destinationId, name: r.name === "Route" ? "" : r.name, directionality: r.directionality, hasStairs: r.hasStairs, hasRamp: r.hasRamp, isCovered: r.isCovered, notes: r.notes || "" });

// Create a new draft (route = null) or edit an existing route.
//  - draft: GPS points are uploaded in batches while the admin walks (resumable), then Save draft / Publish / Discard.
//  - active/inactive: edit metadata and waypoints; "Re-record" captures a new path that REPLACES the geometry on save.
export default function RouteRecorder({ route: initial, locations, onClose }) {
  const { onApiError } = useAdminAuth();
  const active = locations.filter((l) => l.status === "active");
  const [route, setRoute] = useState(initial);
  const [form, setForm] = useState(() => (initial ? toForm(initial) : { sourceId: active[0] ? active[0].id : "", destinationId: active[1] ? active[1].id : "", name: "", directionality: "one_way", hasStairs: null, hasRamp: null, isCovered: null, notes: "" }));
  const [wps, setWps] = useState(initial ? initial.waypointIds : []);
  const [points, setPoints] = useState(initial ? initial.points : []);
  const [replacing, setReplacing] = useState(false), [busy, setBusy] = useState(false), [msg, setMsg] = useState({ kind: "", text: "" }), [conflict, setConflict] = useState(false);
  const draft = !!route && route.status === "draft";

  const uploader = useBatchUploader({ routeId: route && route.id, enabled: draft, initialSaved: initial ? initial.points.length : 0 });
  const gps = useGpsRecorder({ onPoint: (p) => { setPoints((a) => [...a, p]); if (draft) uploader.enqueue(p); } });
  const { stop } = gps;
  useEffect(() => { if (uploader.error && onApiError(uploader.error)) return; }, [uploader.error, onApiError]);

  const report = useCallback((err) => { if (onApiError(err)) return; setConflict(isConflict(err)); setMsg({ kind: "bad", text: errorMessage(err) }); }, [onApiError]);
  const run = (fn) => async () => { setBusy(true); setConflict(false); setMsg({ kind: "", text: "Working…" }); try { await fn(); } catch (e) { report(e); } finally { setBusy(false); } };

  // Step 1: create the draft (no points yet).
  const create = run(async () => {
    if (!form.sourceId || !form.destinationId || Number(form.sourceId) === Number(form.destinationId)) throw Object.assign(new Error("Choose two different registered buildings."), { status: 400 });
    if (!form.name.trim()) throw Object.assign(new Error("Enter a route name."), { status: 400 });
    const created = normRoute(await adminApi.createRoute(routeBody(form, { draft: true, waypointIds: wps })));
    setRoute(created); setPoints([]); setMsg({ kind: "ok", text: "Draft created. Start recording when you are at the source." });
  });
  const reload = useCallback(async () => {
    const fresh = normRoute(await adminApi.getRoute(route.id));
    setRoute(fresh); setForm(toForm(fresh)); setWps(fresh.waypointIds); setPoints(fresh.points); setReplacing(false); setConflict(false);
    return fresh;
  }, [route]);

  function startRecording() {
    if (!draft && !replacing) { setReplacing(true); setPoints([]); gps.start({ seq: 0, last: null }); return; }
    const last = points[points.length - 1] || null;
    gps.start({ seq: points.reduce((m, p) => Math.max(m, p.sequenceNumber || 0), 0), last });
  }
  async function persist() {
    if (draft) { await uploader.flush(); if (uploader.hasPending()) throw Object.assign(new Error("Some recorded points are still uploading. Check your connection and try again."), { status: 0, code: "PENDING" }); }
    if (!form.name.trim()) throw Object.assign(new Error("Enter a route name."), { status: 400 });
    if (replacing && points.length < 2) throw Object.assign(new Error("Record at least 2 points, or leave the path unchanged."), { status: 400 });
    await adminApi.updateRoute(route.id, routeBody(form, { draft, waypointIds: wps, points: replacing ? points : undefined, expectedVersion: route.versionNumber }));
    return reload();
  }
  const save = run(async () => { stop(); await persist(); setMsg({ kind: "ok", text: draft ? "Draft saved." : "Changes saved." }); });
  const publish = run(async () => {
    stop();
    const fresh = await persist();
    if ((fresh.pointCount ?? fresh.points.length) < 2 && points.length < 2) throw Object.assign(new Error("Record at least 2 points before publishing."), { status: 400 });
    await adminApi.publishRoute(route.id, fresh.versionNumber);
    onClose("Route published. It is now visible to the public.");
  });
  const discard = run(async () => { stop(); await adminApi.discardRoute(route.id); onClose("Draft discarded."); });
  function back() { stop(); if (draft && uploader.pending > 0 && !window.confirm("Some points have not uploaded yet. Leave anyway?")) return; onClose(); }

  if (!route) {
    return (
      <form className={styles.card} onSubmit={(e) => { e.preventDefault(); create(); }}>
        <h3>Record a new route</h3>
        <p className={styles.muted}>Choose registered buildings, then walk the real outdoor path with your phone.</p>
        {active.length < 2 ? <Status kind="bad">Register at least two active locations before recording a route.</Status> : <RouteMetaFields value={form} onChange={setForm} locations={locations} />}
        <div className={styles.row} style={{ marginTop: 12 }}><button className={styles.primary} disabled={busy || active.length < 2}>Create draft and continue</button><button type="button" onClick={() => onClose()}>Cancel</button></div>
        <Status kind={msg.kind || undefined}>{msg.text}</Status>
      </form>
    );
  }
  const meters = pathLength(points);
  return (
    <form className={styles.card} onSubmit={(e) => e.preventDefault()}>
      <h3>{draft ? "Draft route" : "Route"} <span className={styles.tag}>{route.status}</span> <span className={styles.muted}>v{route.versionNumber}</span></h3>
      <RouteMetaFields value={form} onChange={setForm} locations={locations} lockEndpoints={!draft} />
      <WaypointSelector locations={locations} sourceId={form.sourceId} destinationId={form.destinationId} value={wps} onChange={setWps} />
      <h2>Path</h2>
      <p className={styles.muted}>{points.length} points · {fmtMeters(meters)}{draft ? ` · ${uploader.saved} saved on server · ${uploader.pending} waiting to upload` : replacing ? " · new path (not saved yet)" : ""}</p>
      <Status kind={gps.status === "recording" ? "ok" : gps.status === "denied" || gps.status === "unavailable" || gps.status === "waiting" && gps.accuracy ? "bad" : undefined}>{gps.message}</Status>
      {uploader.error && uploader.pending > 0 && <Status kind="bad">{`Upload paused: ${errorMessage(uploader.error)} Points are kept and retried automatically.`}</Status>}
      <div className={styles.row}>
        <button type="button" disabled={gps.active || busy} onClick={startRecording}>{draft ? (points.length ? "Continue recording" : "Start recording") : "Re-record path (replaces it when you save)"}</button>
        <button type="button" disabled={!gps.active} onClick={stop}>Stop</button>
      </div>
      <RoutePreview locations={locations} sourceId={form.sourceId} destinationId={form.destinationId} waypointIds={wps} points={points} />
      <div className={styles.row} style={{ marginTop: 12 }}>
        <button type="button" className={styles.primary} disabled={busy} onClick={save}>{draft ? "Save draft" : "Save changes"}</button>
        {draft && <button type="button" disabled={busy} onClick={publish}>Publish</button>}
        {draft && <ConfirmButton label="Discard draft" confirmLabel="Confirm discard" danger disabled={busy} onConfirm={discard} />}
        <button type="button" onClick={back}>Back to list</button>
      </div>
      <Status kind={msg.kind || undefined}>{msg.text}</Status>
      {conflict && <button type="button" onClick={() => reload().then(() => setMsg({ kind: "ok", text: "Reloaded the latest version." })).catch(report)}>Reload latest version</button>}
    </form>
  );
}
