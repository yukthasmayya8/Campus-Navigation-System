import { useEffect, useRef, useState } from 'react';
import {
  adminLocationsAll, createLocation, updateLocation, deactivateLocation, reactivateLocation,
  uploadImage, errorMessage,
} from '../../api.js';
import { LocationPicker } from '../MapView.jsx';
import HistoryPanel from './HistoryPanel.jsx';
import { useLocationCapture } from '../../hooks/useLocationCapture.js';
import { formatFixCoordinates, validateCoordinateInput } from '../../lib/geolocation.js';

const EMPTY = { name: '', description: '', latitude: '', longitude: '', imageUrl: '', confirmNearby: false };
const NO_FIX_META = { source: '', accuracy: null, timestamp: null, quality: null };

export default function LocationManager({ user, onChange }) {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editing, setEditing] = useState(null); // null | 'new' | location
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [history, setHistory] = useState(null);
  const [gpsMeta, setGpsMeta] = useState(NO_FIX_META);
  const gps = useLocationCapture();
  const fileRef = useRef(null);

  async function load() {
    setLoading(true); setErr('');
    try { setLocations(await adminLocationsAll({ limit: 100, offset: 0 })); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const setF = (k) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: value }));
    // A hand-edited coordinate is no longer the captured fix, so hide GPS accuracy metadata.
    if (k === 'latitude' || k === 'longitude') setGpsMeta(NO_FIX_META);
  };

  function closeEditor() {
    gps.reset();
    setGpsMeta(NO_FIX_META);
    setEditing(null);
  }

  function startNew() {
    gps.reset();
    setGpsMeta(NO_FIX_META);
    setEditing('new'); setForm(EMPTY); setErr(''); setMsg('');
  }

  function startEdit(loc) {
    gps.reset();
    setGpsMeta(NO_FIX_META);
    setEditing(loc);
    setForm({
      name: loc.name, description: loc.description || '',
      latitude: loc.latitude, longitude: loc.longitude,
      imageUrl: loc.imageUrl || '', confirmNearby: false,
    });
    setErr(''); setMsg('');
  }

  async function captureLocation() {
    setErr('');
    const result = await gps.capture();
    if (!result) return;
    const coords = formatFixCoordinates(result.fix);
    setForm((f) => ({ ...f, latitude: coords.latitude, longitude: coords.longitude }));
    setGpsMeta({ source: 'gps', accuracy: result.fix.accuracy, timestamp: result.fix.timestamp, quality: result.quality });
    setMsg(result.warning || `GPS fix captured (±${Math.round(result.fix.accuracy)} m). Review the map pin before saving.`);
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setErr('');
    try {
      const { url } = await uploadImage(file);
      setForm((f) => ({ ...f, imageUrl: url }));
      setMsg('Image uploaded. Save the location to keep it.');
    } catch (ex) { setErr(errorMessage(ex)); } finally { setUploading(false); }
  }

  async function save() {
    setErr(''); setMsg('');
    const name = form.name.trim();
    if (!name) { setErr('Building name is required.'); return; }
    const coords = validateCoordinateInput(form.latitude, form.longitude);
    if (!coords.ok) { setErr(coords.message); return; }
    setBusy(true);
    try {
      const payload = {
        name,
        description: form.description.trim(),
        latitude: coords.latitude,
        longitude: coords.longitude,
        imageUrl: form.imageUrl || null,
        confirmNearby: Boolean(form.confirmNearby),
      };
      if (editing === 'new') { await createLocation(payload); setMsg('Location created.'); }
      else { await updateLocation(editing.locationId, { ...payload, expectedVersion: editing.versionNumber }); setMsg('Location updated.'); }
      gps.reset();
      setGpsMeta(NO_FIX_META);
      setEditing(null);
      await load();
      onChange?.();
    } catch (ex) {
      if (ex.code === 'NEARBY_LOCATION') {
        const near = ex.details?.nearby?.[0];
        setErr(`Another building${near?.name ? ` (“${near.name}”)` : ''} is within ${ex.details?.radiusMeters || 15} m. Tick “Confirm anyway” to register it here.`);
      } else {
        const first = Array.isArray(ex.details) ? ex.details[0] : null;
        setErr(first ? `${first.field ? `${first.field}: ` : ''}${first.message}` : errorMessage(ex));
      }
    } finally { setBusy(false); }
  }

  async function toggleStatus(loc) {
    const action = loc.status === 'active' ? 'Deactivate' : 'Reactivate';
    if (!window.confirm(`${action} “${loc.name}”?`)) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      if (loc.status === 'active') await deactivateLocation(loc.locationId, loc.versionNumber);
      else await reactivateLocation(loc.locationId, loc.versionNumber);
      setMsg(`Location ${action.toLowerCase()}d.`);
      await load();
      onChange?.();
    } catch (ex) { setErr(errorMessage(ex)); } finally { setBusy(false); }
  }

  const filtered = locations.filter((l) => {
    const q = filter.trim().toLowerCase();
    return (!q || l.name.toLowerCase().includes(q)) && (statusFilter === 'all' || l.status === statusFilter);
  });

  const pickerValue = form.latitude !== '' && form.longitude !== '' && Number.isFinite(Number(form.latitude)) && Number.isFinite(Number(form.longitude))
    ? { lat: Number(form.latitude), lng: Number(form.longitude) } : null;
  const capturedCoords = gps.fix ? formatFixCoordinates(gps.fix) : null;
  const fixLabel = gps.status === 'waiting' ? 'Waiting for GPS…'
    : gps.status === 'captured' ? 'Recapture location'
      : gps.status === 'error' ? 'Retry location capture' : '📍 Capture My Current Location';

  return (
    <section>
      <div className="section-head">
        <div className="section-title">📍 Campus locations</div>
        <button type="button" className="primary" style={{ width: 'auto', fontSize: 13, padding: '9px 14px' }} onClick={startNew}>+ Add location</button>
      </div>

      {err && <div className="alert error" style={{ marginBottom: 10 }}>{err}</div>}
      {msg && <div className="alert success" style={{ marginBottom: 10 }}>{msg}</div>}

      <div className="toolbar">
        <input type="search" placeholder="Search by name…" value={filter} onInput={(e) => setFilter(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {loading ? <p className="muted">Loading locations…</p> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Coordinates</th><th>Status</th><th>Ver.</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 22 }}>No locations found.</td></tr>}
              {filtered.map((loc) => (
                <tr key={loc.locationId}>
                  <td>
                    <strong>{loc.name}</strong>
                    {loc.imageUrl && <span title="Has photo"> 📷</span>}
                    <div className="muted" style={{ fontSize: 12 }}>{loc.description?.slice(0, 54) || 'No description'}</div>
                  </td>
                  <td className="mono">{Number(loc.latitude).toFixed(5)}, {Number(loc.longitude).toFixed(5)}</td>
                  <td><span className={`badge ${loc.status}`}>{loc.status}</span></td>
                  <td className="muted">v{loc.versionNumber}</td>
                  <td>
                    <div className="actions">
                      <button type="button" onClick={() => startEdit(loc)}>Edit</button>
                      <button type="button" className={loc.status === 'active' ? 'danger' : 'secondary'} onClick={() => toggleStatus(loc)} disabled={busy}>
                        {loc.status === 'active' ? 'Deactivate' : 'Reactivate'}
                      </button>
                      <button type="button" onClick={() => setHistory(loc)}>History</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== null && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeEditor(); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={editing === 'new' ? 'Add location' : `Edit ${editing.name}`}>
            <div className="modal-head">
              <div>
                <h3>{editing === 'new' ? 'Add new location' : `Edit ${editing.name}`}</h3>
                <div className="muted">Stand outdoors at the building entrance, capture your GPS fix, then review the pin before saving.</div>
              </div>
              <button type="button" className="icon ghost" onClick={closeEditor} aria-label="Close">✕</button>
            </div>
            <div className="modal-body stack">
              <label>Building name *
                <input value={form.name} maxLength={150} onChange={setF('name')} placeholder="e.g. Main Block" />
              </label>
              <label>Description
                <textarea value={form.description} maxLength={4000} rows={3} onChange={setF('description')} placeholder="Brief description of this building or facility…" />
              </label>

              <div className="loc-card">
                <div className="loc-card-body">
                  <div className="loc-card-name" style={{ fontSize: 13 }}>GPS capture</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" className="secondary" onClick={captureLocation} disabled={gps.status === 'waiting' || busy} style={{ width: 'auto' }}>
                      {fixLabel}
                    </button>
                    {gps.status === 'waiting' && <button type="button" onClick={gps.cancel}>Cancel capture</button>}
                  </div>
                  {gps.status === 'waiting' && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Waiting for a fresh fix with accuracy of 30 m or better. Enable device location services and stay outdoors.</div>}
                  {gps.message && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{gps.message}</div>}
                  {gps.error && <div className="alert warn" style={{ marginTop: 8, fontSize: 12 }}>{gps.error}</div>}
                  {capturedCoords && (
                    <div style={{ marginTop: 8, fontSize: 12 }}>
                      <div className="muted">Last captured fix{gpsMeta.source !== 'gps' ? ' (coordinates below were edited afterwards)' : ''}:</div>
                      <div className="mono">{capturedCoords.latitude}, {capturedCoords.longitude}</div>
                      <div className="muted">
                        ±{Math.round(gps.fix.accuracy)} m · {new Date(gps.fix.timestamp).toLocaleString()} · {gps.quality === 'good' ? 'good fix' : 'acceptable fix'}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="row">
                <label>Latitude *
                  <input type="number" step="any" value={form.latitude} onChange={setF('latitude')} placeholder="Captured or entered manually" />
                </label>
                <label>Longitude *
                  <input type="number" step="any" value={form.longitude} onChange={setF('longitude')} placeholder="Captured or entered manually" />
                </label>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>Manual fallback: enter values or tap/drag the map pin. This is allowed when GPS is weak, but it is a manual choice rather than a device claim.</div>
              <LocationPicker
                value={pickerValue}
                onChange={(v) => {
                  setForm((f) => ({ ...f, latitude: v.lat.toFixed(7), longitude: v.lng.toFixed(7) }));
                  setGpsMeta(NO_FIX_META);
                }}
                others={locations.filter((l) => editing === 'new' || l.locationId !== editing.locationId)}
                accuracyM={gpsMeta.source === 'gps' && gps.fix ? gps.fix.accuracy : null}
                height={230}
              />
              <label>Building photo URL
                <input value={form.imageUrl} onChange={setF('imageUrl')} placeholder="https://… or upload below" />
              </label>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={handleUpload} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? '⏳ Uploading…' : '📷 Upload photo (compressed automatically)'}
              </button>
              {form.imageUrl && <img src={form.imageUrl} alt="Location preview" style={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 12 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />}

              <label className="checkline">
                <input type="checkbox" checked={form.confirmNearby} onChange={setF('confirmNearby')} />
                <span>Register even if another building is very close (confirm the pin is correct).</span>
              </label>
            </div>
            <div className="modal-foot">
              <button type="button" onClick={closeEditor} disabled={busy}>Cancel</button>
              <button type="button" className="primary" onClick={save} disabled={busy || !form.name.trim() || form.latitude === '' || form.longitude === ''}>
                {busy ? 'Saving…' : editing === 'new' ? 'Add location' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {history && (
        <HistoryPanel
          entityType="location"
          entityId={history.locationId}
          entityName={history.name}
          canRestore={Boolean(user?.canRestore)}
          onClose={() => setHistory(null)}
          onChanged={load}
        />
      )}
    </section>
  );
}
