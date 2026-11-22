import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import TopNav from '../components/TopNav.jsx';
import MapView from '../components/MapView.jsx';
import { useGpsRecorder } from '../hooks/useGpsRecorder.js';
import { useWakeLock } from '../hooks/useWakeLock.js';
import { splitAtGaps, formatDuration, formatDistance, pathLength } from '../lib/geo.js';
import { backgroundHint, wakeLockHint } from '../lib/platform.js';
import {
  adminLocations, appendRoutePoints, createDraftRoute, discardRoute, errorMessage,
  me, publishRoute, updateRoute,
} from '../api.js';

const STORAGE_KEY = 'campus-nav-recorder-draft-v1';
const EMPTY_FORM = { sourceId: '', destId: '', name: '', directionality: 'one_way', stairs: '', ramp: '', covered: '', notes: '' };
const tri = (v) => (v === '' ? null : v === 'true');

function readDraft() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}
function writeDraft(data) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* quota / private mode */ }
}
function clearDraft() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/**
 * Record a route using only real GPS fixes.
 * Points live in the recorder hook (sessionStorage mirrored); upload progress and page state are
 * persisted separately so a reload restores a PAUSED session - it never silently resumes recording.
 */
export default function AdminRecorder() {
  const nav = useNavigate();
  const stored = useRef(readDraft());
  const [locations, setLocations] = useState([]);
  const [form, setForm] = useState(stored.current?.form || EMPTY_FORM);
  const [waypoints, setWaypoints] = useState(Array.isArray(stored.current?.waypoints) ? stored.current.waypoints : []);
  const [phase, setPhase] = useState(() => (['recording', 'review'].includes(stored.current?.phase) ? stored.current.phase : 'setup'));
  const [draft, setDraft] = useState({ routeId: stored.current?.routeId || null, version: stored.current?.version || 1 });
  const [uploadedSeq, setUploadedSeq] = useState(Number(stored.current?.uploadedSeq) || 0);
  const [wpPick, setWpPick] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [uploadErr, setUploadErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [publishAck, setPublishAck] = useState(false);

  const rec = useGpsRecorder();
  const wake = useWakeLock(rec.status === 'recording');
  const flushRef = useRef(null);
  const pointsRef = useRef(rec.points);
  const uploadedRef = useRef(uploadedSeq);
  const routeRef = useRef(draft);
  const flushing = useRef(false);
  const initRef = useRef(true);

  pointsRef.current = rec.points;
  routeRef.current = draft;

  useEffect(() => {
    me()
      .then((d) => {
        if (d.user?.forcePasswordChange) { nav('/admin/login', { replace: true }); return; }
        return adminLocations();
      })
      .then((items) => setLocations(items || []))
      .catch((e) => {
        if (e.status === 401 || e.code === 'PASSWORD_CHANGE_REQUIRED') nav('/admin/login', { replace: true });
        else setErr(errorMessage(e));
      });
  }, [nav]);

  /* Persist page-level recording state (route id, upload cursor, waypoints, form). */
  useEffect(() => {
    writeDraft({
      routeId: draft.routeId, version: draft.version, uploadedSeq,
      waypoints, phase, form, savedAt: new Date().toISOString(),
    });
  }, [draft, uploadedSeq, waypoints, phase, form]);

  /* A restored GPS session means the page reloaded mid-recording: show it as paused, never active. */
  useEffect(() => {
    if (!initRef.current) return;
    initRef.current = false;
    if (rec.points.length && !draft.routeId) {
      setMsg('A GPS session was restored but its server draft is missing. Discard it or record a new route.');
    } else if (rec.points.length && phase === 'setup') {
      setPhase('review');
      setMsg('Recording restored after reload. It is paused; press Resume recording to continue, or review and save.');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Copy the hook's own reload message into the recorder banner once. */
  useEffect(() => {
    if (rec.message && rec.points.length) setMsg(rec.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.status]);

  const nameOf = (id) => locations.find((l) => String(l.locationId) === String(id))?.name || `#${id}`;

  async function flushUpload() {
    const id = routeRef.current.routeId;
    if (!id || flushing.current) return true;
    const batch = pointsRef.current.filter((p) => p.sequenceNumber > uploadedRef.current);
    if (!batch.length) return true;
    flushing.current = true;
    try {
      await appendRoutePoints(id, batch);
      uploadedRef.current = batch[batch.length - 1].sequenceNumber;
      setUploadedSeq(uploadedRef.current);
      setUploadErr('');
      return true;
    } catch (e) {
      setUploadErr(`${pointsRef.current.length - uploadedRef.current} point(s) kept on this device — ${errorMessage(e)}`);
      return false;
    } finally { flushing.current = false; }
  }
  flushRef.current = flushUpload;

  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const t = setInterval(() => flushRef.current?.(), 5000);
    return () => clearInterval(t);
  }, [phase]);

  const metadata = () => ({
    routeName: form.name.trim(),
    directionality: form.directionality,
    hasStairs: tri(form.stairs),
    hasRamp: tri(form.ramp),
    isCovered: tri(form.covered),
    notes: form.notes.trim() || null,
    waypointLocationIds: waypoints,
  });

  function validSetup() {
    if (!form.sourceId || !form.destId) return 'Choose a start and a destination building.';
    if (String(form.sourceId) === String(form.destId)) return 'Start and destination must be different.';
    if (!form.name.trim()) return 'Enter a route name.';
    return '';
  }

  async function startRecording() {
    const problem = validSetup();
    setErr(''); setMsg(''); setUploadErr('');
    if (problem) { setErr(problem); return; }
    setBusy(true);
    try {
      let id = draft.routeId;
      let version = draft.version;
      if (!id) {
        const created = await createDraftRoute({
          sourceLocationId: Number(form.sourceId),
          destinationLocationId: Number(form.destId),
          ...metadata(),
        });
        id = created.routeId;
        version = created.versionNumber;
        uploadedRef.current = 0;
        setUploadedSeq(0);
        routeRef.current = { routeId: id, version };
        setDraft({ routeId: id, version });
      } else {
        const updated = await updateRoute(id, { expectedVersion: version, ...metadata() });
        version = updated.versionNumber;
        routeRef.current = { routeId: id, version };
        setDraft({ routeId: id, version });
      }
      setPhase('recording');
      rec.start({ keepPoints: false });
      wake.acquire();
      setMsg('Recording. Stand at the start building and begin walking; points are only saved once GPS accuracy is good enough.');
    } catch (e) {
      setErr(errorMessage(e));
    } finally { setBusy(false); }
  }

  async function resumeRecording() {
    setErr(''); setUploadErr('');
    if (!draft.routeId) { setErr('The server draft is missing. Discard and start a new recording.'); return; }
    setPhase('recording');
    rec.resume();
  }

  async function stopRecording() {
    rec.stop();
    setPhase('review');
    setBusy(true);
    for (let i = 0; i < 3; i++) {
      const ok = await flushUpload();
      if (ok) break;
    }
    setBusy(false);
    setMsg(rec.gaps.length
      ? 'Recording stopped. GPS gaps are marked; review the path before publishing.'
      : 'Recording stopped. Review the path and save or publish.');
  }

  function addWaypoint() {
    if (!wpPick) return;
    const id = Number(wpPick);
    if (!waypoints.includes(id)) setWaypoints([...waypoints, id]);
    setWpPick('');
  }
  const removeWaypoint = (id) => setWaypoints(waypoints.filter((w) => w !== id));
  const moveWaypoint = (index, delta) => {
    const next = [...waypoints];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setWaypoints(next);
  };

  async function save(publish) {
    setErr(''); setMsg('');
    if (!draft.routeId) { setErr('No server draft exists for this recording.'); return; }
    if (rec.points.length < 2) { setErr('At least two real GPS points are required.'); return; }
    if (rec.gaps.length && publish && !publishAck) { setErr('Tick the acknowledgement about the GPS gaps before publishing.'); return; }
    setBusy(true);
    try {
      const uploaded = await flushUpload();
      if (!uploaded) throw new Error('Some GPS points are not uploaded yet. Check your connection and try again.');
      const updated = await updateRoute(draft.routeId, { expectedVersion: draft.version, ...metadata() });
      setDraft({ routeId: draft.routeId, version: updated.versionNumber });
      if (publish) {
        const published = await publishRoute(draft.routeId, updated.versionNumber);
        setDraft({ routeId: draft.routeId, version: published.versionNumber });
        setPhase('done');
        setMsg('Route published. It is now visible to the public.');
        // A published route is finished: never restore it later as a paused recording.
        rec.reset();
        clearDraft();
        setDraft({ routeId: null, version: 1 });
        setUploadedSeq(0); uploadedRef.current = 0;
        setForm(EMPTY_FORM); setWaypoints([]); setPublishAck(false);
      } else {
        setMsg('Draft saved on the server. It stays hidden from the public until published.');
      }
    } catch (e) {
      setErr(errorMessage(e));
    } finally { setBusy(false); }
  }

  async function discard() {
    if (!window.confirm('Discard this recording? Uploaded draft points are deleted and cannot be recovered.')) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      if (draft.routeId) await discardRoute(draft.routeId).catch((e) => { if (e.status !== 404) throw e; });
      resetEverything();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  function resetEverything() {
    rec.reset();
    clearDraft();
    setDraft({ routeId: null, version: 1 });
    setUploadedSeq(0); uploadedRef.current = 0;
    setForm(EMPTY_FORM); setWaypoints([]); setPublishAck(false); setUploadErr('');
    setPhase('setup'); setMsg('Recording discarded. You can record again.'); setErr('');
  }

  const segments = splitAtGaps(rec.points, rec.gaps);
  const waypointPreview = waypoints.map((id) => ({ locationId: id, name: nameOf(id) }));
  const previewRoute = rec.points.length ? { points: rec.points, segments, waypoints: waypointPreview } : null;
  const lastPoint = rec.points[rec.points.length - 1];
  const pending = Math.max(0, rec.points.length - uploadedSeq);
  const canPublish = phase === 'review' && rec.points.length >= 2 && pending === 0 && !busy && (!rec.gaps.length || publishAck);
  const statusLabel = rec.status === 'recording' ? 'Recording' : rec.status === 'paused' ? 'Paused' : rec.status === 'denied' ? 'Permission denied' : rec.status === 'stopped' ? 'Stopped' : rec.status === 'unavailable' ? 'GPS unavailable' : 'Ready';

  return (
    <div className="recorder-page">
      <TopNav right={<Link to="/admin" className="navlink">← Dashboard</Link>} />
      <div className="rec-layout">
        <div className="rec-map">
          <MapView
            locations={locations}
            route={previewRoute}
            userPosition={lastPoint ? { latitude: lastPoint.latitude, longitude: lastPoint.longitude, accuracy: lastPoint.accuracy } : null}
            startId={Number(form.sourceId) || null}
            destinationId={Number(form.destId) || null}
            fit={phase !== 'recording'}
            followMe={phase === 'recording'}
          />
        </div>

        <aside className="rec-panel">
          <div className="stack">
            <div>
              <h1 className="page-title" style={{ fontSize: 22 }}>Record a route</h1>
              <p className="muted" style={{ fontSize: 12.5 }}>Real GPS only — points are saved solely from the browser's location fixes.</p>
            </div>

            {err && <div className="alert error">{err}</div>}
            {msg && <div className="alert info">{msg}</div>}
            {uploadErr && <div className="alert warn">{uploadErr}</div>}

            {phase === 'setup' && (
              <>
                {rec.hasSession && !draft.routeId && (
                  <div className="alert warn">
                    An incomplete restored GPS session has no server draft. Discard it before starting again.
                    <button type="button" className="link" style={{ marginLeft: 6 }} onClick={resetEverything}>Discard</button>
                  </div>
                )}
                <label>Start building
                  <select value={form.sourceId} onChange={(e) => setForm({ ...form, sourceId: e.target.value })}>
                    <option value="">Select…</option>
                    {locations.map((l) => <option key={l.locationId} value={l.locationId}>{l.name}</option>)}
                  </select>
                </label>
                <label>Destination building
                  <select value={form.destId} onChange={(e) => setForm({ ...form, destId: e.target.value })}>
                    <option value="">Select…</option>
                    {locations.map((l) => <option key={l.locationId} value={l.locationId}>{l.name}</option>)}
                  </select>
                </label>
                <label>Route name
                  <input value={form.name} maxLength={150} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Main Block to Library via quad" />
                </label>
                <label>Directionality
                  <select value={form.directionality} onChange={(e) => setForm({ ...form, directionality: e.target.value })}>
                    <option value="one_way">One way (source → destination)</option>
                    <option value="bidirectional">Bidirectional (verified safe in reverse)</option>
                  </select>
                </label>
                {[['stairs', 'Has stairs'], ['ramp', 'Has ramp'], ['covered', 'Covered walkway']].map(([key, label]) => (
                  <label key={key}>{label}
                    <select value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
                      <option value="">Not verified</option>
                      <option value="true">Verified: yes</option>
                      <option value="false">Verified: no</option>
                    </select>
                  </label>
                ))}
                <label>Notes
                  <input value={form.notes} maxLength={2000} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional landmarks or access notes" />
                </label>
                <button type="button" className="primary" onClick={startRecording} disabled={busy}>
                  {busy ? 'Starting…' : 'Start recording'}
                </button>
                <p className="muted" style={{ fontSize: 12 }}>
                  Locations must already be registered and active. Walk outdoors; GPS does not work reliably indoors.
                </p>
              </>
            )}

            {(phase === 'recording' || (phase === 'review' && rec.points.length > 0)) && (
              <>
                <div className="rec-status">
                  <span className={`rec-dot ${rec.status}`} />
                  <div className="grow">
                    <strong>{statusLabel}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {rec.status === 'recording' ? 'Receiving GPS fixes' : rec.status === 'paused' ? 'Recording is paused — resume before walking on' : rec.message || 'Not receiving GPS'}
                    </div>
                  </div>
                  {rec.accuracy != null && <span className={`chip ${rec.accuracy <= 25 ? 'green' : 'amber'}`}>±{Math.round(rec.accuracy)} m</span>}
                   {wake.supported && <span className={`chip ${wake.state === 'on' ? 'green' : 'amber'}`}>{wake.state === 'on' ? 'Screen awake' : 'Screen may lock'}</span>}
                </div>

                <div className="rec-stats">
                  <div className="rec-stat"><b>{rec.points.length}</b><span>Points</span></div>
                  <div className="rec-stat"><b>{formatDuration(rec.elapsedMs)}</b><span>Duration</span></div>
                  <div className="rec-stat"><b>{pending}</b><span>Pending</span></div>
                </div>

                {rec.gaps.length > 0 && <div className="alert warn">{rec.gaps.length} GPS gap{rec.gaps.length > 1 ? 's' : ''} marked. The path is split at each gap; publishing needs your acknowledgement.</div>}
                <div className={`alert ${wake.supported && wake.state !== 'error' ? 'info' : 'warn'}`}>
                  {wake.supported
                    ? `${wake.state === 'on' ? 'Screen wake lock is on.' : 'Screen wake lock requested.'} ${wakeLockHint()}`
                    : wakeLockHint()} {backgroundHint()}
                </div>

                {phase === 'recording' && (
                  <>
                    <label>Mark a building you are passing
                      <div className="row">
                        <select value={wpPick} onChange={(e) => setWpPick(e.target.value)}>
                          <option value="">Select building…</option>
                          {locations.filter((l) => !waypoints.includes(l.locationId)).map((l) => <option key={l.locationId} value={l.locationId}>{l.name}</option>)}
                        </select>
                        <button type="button" onClick={addWaypoint} disabled={!wpPick} style={{ flex: '0 0 auto' }}>Add</button>
                      </div>
                    </label>
                    <WaypointList ids={waypoints} nameOf={nameOf} onRemove={removeWaypoint} onMove={moveWaypoint} />

                    {rec.status === 'recording' ? (
                      <div className="row">
                        <button type="button" onClick={rec.pause}>Pause</button>
                        <button type="button" className="primary" style={{ width: 'auto' }} onClick={stopRecording} disabled={rec.points.length < 2 || busy}>Finish &amp; review</button>
                      </div>
                    ) : (
                      <div className="row">
                        <button type="button" className="primary" style={{ width: 'auto' }} onClick={resumeRecording} disabled={!draft.routeId}>Resume recording</button>
                        <button type="button" onClick={stopRecording} disabled={rec.points.length < 2 || busy}>Finish &amp; review</button>
                      </div>
                    )}
                    {rec.points.length < 2 && <p className="muted" style={{ fontSize: 12 }}>Keep walking — at least two valid GPS points are needed.</p>}
                    <button type="button" className="link" onClick={discard} disabled={busy}>
                      Cancel and discard this recording
                    </button>
                  </>
                )}
              </>
            )}

            {phase === 'review' && (
              <>
                <div className="panel-card stack sm">
                  <div className="section-title">Preview &amp; publish</div>
                  <p className="muted" style={{ fontSize: 12.5 }}>
                    {rec.points.length} real GPS points · {formatDistance(pathLength(rec.points))} · {segments.length} segment{segments.length === 1 ? '' : 's'} · {formatDuration(rec.elapsedMs)} recorded
                  </p>
                  {pending > 0 && (
                    <div className="alert warn">
                      {pending} point(s) are not uploaded yet.{' '}
                      <button type="button" className="link" onClick={() => flushUpload()}>Retry upload</button>
                    </div>
                  )}
                  {rec.gaps.length > 0 && (
                    <label className="checkline">
                      <input type="checkbox" checked={publishAck} onChange={(e) => setPublishAck(e.target.checked)} />
                      <span>I understand the {rec.gaps.length} marked GPS gap{rec.gaps.length > 1 ? 's' : ''} mean the route line is broken there, and the route can still be published.</span>
                    </label>
                  )}
                  <div className="row">
                    <button type="button" onClick={() => save(false)} disabled={busy || rec.points.length < 2}>Save draft</button>
                    <button type="button" className="primary" style={{ width: 'auto' }} onClick={() => save(true)} disabled={!canPublish}>Publish</button>
                  </div>
                  <button type="button" onClick={discard} disabled={busy}>Discard &amp; re-record</button>
                </div>

                <label>Waypoints (walking order)
                  <div className="row">
                    <select value={wpPick} onChange={(e) => setWpPick(e.target.value)}>
                      <option value="">Add a building…</option>
                      {locations.filter((l) => !waypoints.includes(l.locationId)).map((l) => <option key={l.locationId} value={l.locationId}>{l.name}</option>)}
                    </select>
                    <button type="button" onClick={addWaypoint} disabled={!wpPick} style={{ flex: '0 0 auto' }}>Add</button>
                  </div>
                </label>
                <WaypointList ids={waypoints} nameOf={nameOf} onRemove={removeWaypoint} onMove={moveWaypoint} />

                {rec.status !== 'recording' && (
                  <button type="button" onClick={resumeRecording} disabled={!draft.routeId}>Resume recording (add more points)</button>
                )}
              </>
            )}

            {phase === 'done' && (
              <>
                <div className="alert success">Route published and now visible to the public. Drafts are never public.</div>
                <button type="button" className="primary" onClick={resetEverything}>Record another route</button>
              </>
            )}

            <p className="muted" style={{ fontSize: 11.5 }}>
              Recorded data belongs to this browser session. Reloading restores a paused session; it never resumes recording without your tap.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function WaypointList({ ids, nameOf, onRemove, onMove }) {
  if (!ids.length) return <p className="muted" style={{ fontSize: 12 }}>No waypoints marked.</p>;
  return (
    <ol className="wps">
      {ids.map((id, i) => (
        <li key={id}>
          <span className="grow">{i + 1}. {nameOf(id)}</span>
          {onMove && (
            <>
              <button type="button" onClick={() => onMove(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button type="button" onClick={() => onMove(i, 1)} disabled={i === ids.length - 1} aria-label="Move down">↓</button>
            </>
          )}
          {onRemove && <button type="button" className="link" onClick={() => onRemove(id)}>remove</button>}
        </li>
      ))}
    </ol>
  );
}
