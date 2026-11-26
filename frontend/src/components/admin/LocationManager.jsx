import { useEffect, useRef, useState } from 'react';
import {
  adminLocationsAll, createLocation, updateLocation, deactivateLocation, reactivateLocation,
  uploadImage, errorMessage,
} from '../../api.js';
import { LocationPicker } from '../MapView.jsx';
import HistoryPanel from './HistoryPanel.jsx';

const EMPTY = { name: '', description: '', latitude: '', longitude: '', imageUrl: '', confirmNearby: false };

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
  const fileRef = useRef(null);

  async function load() {
    setLoading(true); setErr('');
    try { setLocations(await adminLocationsAll({ limit: 100, offset: 0 })); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const setF = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  function startNew() { setEditing('new'); setForm(EMPTY); setErr(''); setMsg(''); }
  function startEdit(loc) {
    setEditing(loc);
    setForm({
      name: loc.name, description: loc.description || '',
      latitude: loc.latitude, longitude: loc.longitude,
      imageUrl: loc.imageUrl || '', confirmNearby: false,
    });
    setErr(''); setMsg('');
  }

  async function useMyLocation() {
    setErr('');
    if (!('geolocation' in navigator)) { setErr('GPS is not supported in this browser.'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setForm((f) => ({ ...f, latitude: p.coords.latitude.toFixed(7), longitude: p.coords.longitude.toFixed(7) }));
        setBusy(false);
        setMsg('Coordinates filled from your current GPS position.');
      },
      (e) => { setErr(e.code === 1 ? 'Location permission denied.' : 'Could not get your position.'); setBusy(false); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
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
    setErr(''); setBusy(true); setMsg('');
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        imageUrl: form.imageUrl || null,
        confirmNearby: Boolean(form.confirmNearby),
      };
      if (editing === 'new') { await createLocation(payload); setMsg('Location created.'); }
      else { await updateLocation(editing.locationId, { ...payload, expectedVersion: editing.versionNumber }); setMsg('Location updated.'); }
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
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={editing === 'new' ? 'Add location' : `Edit ${editing.name}`}>
            <div className="modal-head">
              <div>
                <h3>{editing === 'new' ? 'Add new location' : `Edit ${editing.name}`}</h3>
                <div className="muted">Tap the map or drag the pin to correct the coordinates.</div>
              </div>
              <button type="button" className="icon ghost" onClick={() => setEditing(null)} aria-label="Close">✕</button>
            </div>
            <div className="modal-body stack">
              <label>Building name *
                <input value={form.name} maxLength={150} onChange={setF('name')} placeholder="e.g. Main Block" />
              </label>
              <label>Description
                <textarea value={form.description} maxLength={4000} rows={3} onChange={setF('description')} placeholder="Brief description of this building or facility…" />
              </label>
              <div className="row">
                <label>Latitude *
                  <input type="number" step="any" value={form.latitude} onChange={setF('latitude')} placeholder="13.2548" />
                </label>
                <label>Longitude *
                  <input type="number" step="any" value={form.longitude} onChange={setF('longitude')} placeholder="74.7852" />
                </label>
              </div>
              <button type="button" onClick={useMyLocation} disabled={busy} style={{ width: 'auto' }}>
                📍 Use my current location
              </button>
              <LocationPicker
                value={pickerValue}
                onChange={(v) => setForm((f) => ({ ...f, latitude: v.lat.toFixed(7), longitude: v.lng.toFixed(7) }))}
                others={locations.filter((l) => editing === 'new' || l.locationId !== editing.locationId)}
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
              <button type="button" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
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
