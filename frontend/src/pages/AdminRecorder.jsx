import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import TopNav from '../components/TopNav.jsx';
import CampusMap from '../components/CampusMap.jsx';
import { me, adminLocations, createDraftRoute, appendRoutePoints, updateRoute, publishRoute, discardRoute } from '../api.js';
import { GpsFilter, haversine } from '../lib/geo.js';

const MIN_SPACING_M = 3;   // do not store points closer than this (stops stationary GPS noise)
const MAX_ACCURACY_M = 25;
const tri = (v) => (v === '' ? null : v === 'true');

/* Route recording workflow: choose endpoints -> walk & record (batches uploaded every 5 s) -> mark waypoints ->
   preview -> discard / save draft / publish. Every point carries its own sequenceNumber, so a retried batch is idempotent. */
export default function AdminRecorder() {
  const nav = useNavigate();
  const [locations, setLocations] = useState([]);
  const [form, setForm] = useState({ sourceId: '', destId: '', name: '', directionality: 'one_way', stairs: '', ramp: '', covered: '', notes: '' });
  const [phase, setPhase] = useState('setup'); // setup | recording | review | done
  const [points, setPoints] = useState([]);
  const [waypoints, setWaypoints] = useState([]);  // ordered location ids
  const [wpPick, setWpPick] = useState('');
  const [pending, setPending] = useState(0);
  const [pos, setPos] = useState(null);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const route = useRef({ id: null, version: 1 });
  const buffer = useRef([]); const seq = useRef(0); const filter = useRef(new GpsFilter({ maxAccuracy: MAX_ACCURACY_M, maxSpeed: 10 }));
  const lastKept = useRef(null); const watch = useRef(null); const timer = useRef(null); const flushing = useRef(false);

  useEffect(() => {
    me().then((d) => { if (d.user.forcePasswordChange) nav('/admin/login'); return adminLocations(); }).then(setLocations)
      .catch((e) => (e.status === 401 || e.code === 'PASSWORD_CHANGE_REQUIRED' ? nav('/admin/login') : setErr(e.message)));
    return () => { stopWatch(); };
  }, [nav]);

  const stopWatch = () => {
    if (watch.current !== null) { navigator.geolocation.clearWatch(watch.current); watch.current = null; }
    clearInterval(timer.current); timer.current = null;
  };
  const nameOf = (id) => locations.find((l) => l.locationId === Number(id))?.name ?? `#${id}`;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function flush() {
    if (flushing.current || !buffer.current.length || !route.current.id) return;
    flushing.current = true;
    const batch = buffer.current.slice(0, 500);
    try {
      await appendRoutePoints(route.current.id, batch);       // idempotent thanks to sequenceNumber
      buffer.current = buffer.current.slice(batch.length); setPending(buffer.current.length); setErr('');
    } catch (e) {
      if (e.status === 401 || e.status === 403) { setErr('Session problem: ' + e.message); stopWatch(); }
      else setErr(`Upload pending (${buffer.current.length} points kept on this device): ${e.message}`);
    } finally { flushing.current = false; }
  }

  async function start() {
    setErr(''); setMsg('');
    const { sourceId, destId, name } = form;
    if (!sourceId || !destId || !name.trim()) return setErr('Choose a start, a destination and enter a route name.');
    if (sourceId === destId) return setErr('Start and destination must be different.');
    if (!('geolocation' in navigator)) return setErr('This browser does not support GPS.');
    setBusy(true);
    try {
      const d = await createDraftRoute({ sourceLocationId: Number(sourceId), destinationLocationId: Number(destId), routeName: name.trim(),
        directionality: form.directionality, hasStairs: tri(form.stairs), hasRamp: tri(form.ramp), isCovered: tri(form.covered), notes: form.notes || null });
      route.current = { id: d.routeId, version: d.versionNumber };
      buffer.current = []; seq.current = 0; lastKept.current = null; filter.current.reset(); setPoints([]); setWaypoints([]);
      watch.current = navigator.geolocation.watchPosition((p) => {
        const f = filter.current.accept({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp });
        if (!f.ok) return setMsg(f.reason === 'low_accuracy' ? `GPS accuracy is poor (${Math.round(p.coords.accuracy)} m). Waiting for a better signal…` : 'Ignored an unreliable GPS jump.');
        setMsg(''); setPos(f.position);
        if (lastKept.current && haversine(lastKept.current, f.position) < MIN_SPACING_M) return;
        lastKept.current = f.position;
        const pt = { sequenceNumber: ++seq.current, latitude: f.position.latitude, longitude: f.position.longitude, accuracy: Math.round(f.accuracy * 10) / 10, recordedAt: new Date(p.timestamp).toISOString() };
        buffer.current.push(pt); setPending(buffer.current.length); setPoints((a) => [...a, pt]);
      }, (e) => setErr(e.code === 1 ? 'Location permission denied. Allow GPS to record a route.' : 'GPS unavailable: ' + e.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
      timer.current = setInterval(flush, 5000);
      setPhase('recording');
    } catch (e) { setErr(e.details?.[0] ? `${e.details[0].field}: ${e.details[0].message}` : e.message); } finally { setBusy(false); }
  }

  async function finish() {
    stopWatch(); setBusy(true);
    for (let i = 0; i < 3 && buffer.current.length; i++) await flush();   // retry a few times
    setBusy(false);
    if (buffer.current.length) setErr(`${buffer.current.length} points could not be uploaded yet. Check your connection and press "Retry upload".`);
    setPhase('review');
  }
  const addWaypoint = () => { if (wpPick && !waypoints.includes(Number(wpPick))) setWaypoints([...waypoints, Number(wpPick)]); setWpPick(''); };

  async function persist(publish) {
    setErr(''); setBusy(true);
    try {
      await flush(); if (buffer.current.length) throw new Error('Some GPS points are not uploaded yet. Retry the upload first.');
      const upd = await updateRoute(route.current.id, { expectedVersion: route.current.version, waypointLocationIds: waypoints,
        routeName: form.name.trim(), directionality: form.directionality, hasStairs: tri(form.stairs), hasRamp: tri(form.ramp), isCovered: tri(form.covered), notes: form.notes || null });
      route.current.version = upd.versionNumber;
      if (publish) { const p = await publishRoute(route.current.id, route.current.version); route.current.version = p.versionNumber; setPhase('done'); setMsg('Route published.'); }
      else setMsg('Draft saved. It is not visible to the public until published.');
    } catch (e) { setErr(e.status === 409 ? `Conflict: ${e.message}` : e.details?.[0]?.message ? `${e.message}: ${e.details[0].message}` : e.message); } finally { setBusy(false); }
  }
  async function discard() {
    if (!window.confirm('Discard this recording? The draft will be deleted.')) return;
    setBusy(true); setErr('');
    try { stopWatch(); if (route.current.id) await discardRoute(route.current.id); route.current = { id: null, version: 1 }; buffer.current = []; setPoints([]); setWaypoints([]); setPending(0); setPhase('setup'); setMsg('Recording discarded. You can record again.'); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const preview = { points, waypoints: waypoints.map((id) => ({ locationId: id, name: nameOf(id) })) };
  const canPublish = phase === 'review' && points.length >= 2 && !pending && !busy;

  return (
    <div className="page">
      <TopNav right={<Link to="/admin" className="navlink">Back</Link>} />
      <div className="rec-layout">
        <aside className="panel" style={{ width: 380 }}>
          <h2>Record a route</h2>
          {phase === 'setup' && (<>
            <label>Start building<select value={form.sourceId} onChange={set('sourceId')}><option value="">Select…</option>{locations.map((l) => <option key={l.locationId} value={l.locationId}>{l.name}</option>)}</select></label>
            <label>Destination building<select value={form.destId} onChange={set('destId')}><option value="">Select…</option>{locations.map((l) => <option key={l.locationId} value={l.locationId}>{l.name}</option>)}</select></label>
            <label>Route name<input value={form.name} maxLength={150} onChange={set('name')} placeholder="e.g. Via playground" /></label>
            <label>Directionality<select value={form.directionality} onChange={set('directionality')}><option value="one_way">One way (source → destination)</option><option value="bidirectional">Bidirectional (verified safe in reverse)</option></select></label>
            {[['stairs', 'Has stairs'], ['ramp', 'Has ramp'], ['covered', 'Covered walkway']].map(([k, label]) => (
              <label key={k}>{label}<select value={form[k]} onChange={set(k)}><option value="">Not verified</option><option value="true">Verified: yes</option><option value="false">Verified: no</option></select></label>))}
            <label>Notes<input value={form.notes} maxLength={2000} onChange={set('notes')} /></label>
            <button className="primary" disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Start recording'}</button>
            <small className="muted">Stand at the start building, press start, then walk the path. Locations must already be registered and active.</small>
          </>)}

          {phase === 'recording' && (<>
            <div className="stats"><div className="stat"><b>{points.length}</b>points</div><div className="stat"><b>{pending}</b>not uploaded</div></div>
            <p><strong>{form.name}</strong>: {nameOf(form.sourceId)} → {nameOf(form.destId)}</p>
            <label>Mark a building you are passing
              <div className="row"><select value={wpPick} onChange={(e) => setWpPick(e.target.value)}><option value="">Select…</option>
                {locations.filter((l) => !waypoints.includes(l.locationId)).map((l) => <option key={l.locationId} value={l.locationId}>{l.name}</option>)}</select>
                <button onClick={addWaypoint} disabled={!wpPick} style={{ flex: '0 0 auto' }}>Add</button></div></label>
            <WaypointList ids={waypoints} nameOf={nameOf} />
            <button className="primary" onClick={finish} disabled={points.length < 2}>Finish at destination</button>
            {points.length < 2 && <small className="muted">Keep walking; at least 2 points are needed.</small>}
          </>)}

          {phase === 'review' && (<>
            <p><strong>{points.length}</strong> points recorded. Check the preview on the map.</p>
            <label>Waypoints (in walking order)
              <div className="row"><select value={wpPick} onChange={(e) => setWpPick(e.target.value)}><option value="">Add a building…</option>
                {locations.filter((l) => !waypoints.includes(l.locationId)).map((l) => <option key={l.locationId} value={l.locationId}>{l.name}</option>)}</select>
                <button onClick={addWaypoint} disabled={!wpPick} style={{ flex: '0 0 auto' }}>Add</button></div></label>
            <WaypointList ids={waypoints} nameOf={nameOf} onRemove={(id) => setWaypoints(waypoints.filter((w) => w !== id))} />
            {pending > 0 && <button onClick={flush}>Retry upload ({pending} pending)</button>}
            <div className="row" style={{ marginTop: 10 }}>
              <button onClick={() => persist(false)} disabled={busy || points.length < 2}>Save draft</button>
              <button className="primary" onClick={() => persist(true)} disabled={!canPublish}>Publish</button>
            </div>
            <button style={{ marginTop: 8, width: '100%' }} onClick={discard} disabled={busy}>Discard &amp; re-record</button>
          </>)}

          {phase === 'done' && <><div className="alert info-box">Route published and now visible to the public.</div><button className="primary" onClick={() => { route.current = { id: null, version: 1 }; setPoints([]); setWaypoints([]); setPhase('setup'); setMsg(''); }}>Record another alternative</button></>}
          {msg && <div className="alert info-box">{msg}</div>}
          {err && <div className="alert error">{err}</div>}
        </aside>
        <div className="rec-map">
          <CampusMap locations={locations} route={points.length ? preview : null} userPosition={phase === 'recording' ? pos : null}
            startId={Number(form.sourceId) || null} destinationId={Number(form.destId) || null} fit={phase !== 'recording'} />
        </div>
      </div>
    </div>
  );
}

function WaypointList({ ids, nameOf, onRemove }) {
  if (!ids.length) return <small className="muted">No waypoints marked.</small>;
  return <ol className="wps">{ids.map((id) => <li key={id}>{nameOf(id)}{onRemove && <button className="link" onClick={() => onRemove(id)}>remove</button>}</li>)}</ol>;
}
