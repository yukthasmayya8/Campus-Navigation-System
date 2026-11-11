import { useEffect, useState, useRef } from 'react';
import CampusMap from './CampusMap.jsx';
import {
  adminLocationsAll, createLocation, updateLocation,
  deactivateLocation, reactivateLocation, uploadImage,
  getLocationVersions, restoreLocation,
} from '../api.js';

const EMPTY_FORM = { name: '', description: '', latitude: '', longitude: '', imageUrl: '', confirmNearby: false };

export default function AdminLocationsManager({ user }) {
  const [locations, setLocations]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [err, setErr]               = useState('');
  const [msg, setMsg]               = useState('');
  const [editing, setEditing]       = useState(null);  // null | 'new' | {loc}
  const [form, setForm]             = useState(EMPTY_FORM);
  const [busy, setBusy]             = useState(false);
  const [filter, setFilter]         = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [imageUploading, setImageUploading] = useState(false);
  const fileRef = useRef(null);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const items = await adminLocationsAll();
      setLocations(items);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  function startNew() {
    setEditing('new');
    setForm(EMPTY_FORM);
    setErr(''); setMsg('');
  }
  function startEdit(loc) {
    setEditing(loc);
    setForm({ name: loc.name, description: loc.description || '', latitude: loc.latitude, longitude: loc.longitude, imageUrl: loc.imageUrl || '', confirmNearby: false });
    setErr(''); setMsg('');
  }
  function cancelEdit() { setEditing(null); setErr(''); setMsg(''); }

  const setF = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function handleImageUpload(e) {
    const file = e.target.files[0]; if (!file) return;
    setImageUploading(true); setErr('');
    try {
      const { url } = await uploadImage(file);
      setForm((f) => ({ ...f, imageUrl: url }));
      setMsg('Image uploaded.');
    } catch (ex) { setErr(ex.message); }
    finally { setImageUploading(false); }
  }

  async function save() {
    setErr(''); setBusy(true); setMsg('');
    try {
      const payload = {
        name: form.name.trim(), description: form.description.trim(),
        latitude: Number(form.latitude), longitude: Number(form.longitude),
        imageUrl: form.imageUrl || null, confirmNearby: form.confirmNearby,
      };
      if (editing === 'new') {
        await createLocation(payload);
        setMsg('Location created.');
      } else {
        await updateLocation(editing.locationId, { ...payload, expectedVersion: editing.versionNumber });
        setMsg('Location updated.');
      }
      await load(); cancelEdit();
    } catch (ex) {
      if (ex.code === 'NEARBY_LOCATION') {
        setErr(`Another building is within ${ex.details?.nearby?.[0]?.name ? '"' + ex.details.nearby[0].name + '"' : '15 m'}. Check "Confirm anyway" to proceed.`);
      } else {
        setErr(ex.details?.[0]?.message || ex.message);
      }
    } finally { setBusy(false); }
  }

  async function toggleStatus(loc) {
    if (!window.confirm(`${loc.status === 'active' ? 'Deactivate' : 'Reactivate'} "${loc.name}"?`)) return;
    setBusy(true); setErr('');
    try {
      if (loc.status === 'active') await deactivateLocation(loc.locationId, loc.versionNumber);
      else await reactivateLocation(loc.locationId, loc.versionNumber);
      setMsg(`Location ${loc.status === 'active' ? 'deactivated' : 'reactivated'}.`);
      await load();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }

  const filtered = locations.filter((l) => {
    const q = filter.toLowerCase();
    const matchName = l.name.toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || l.status === statusFilter;
    return matchName && matchStatus;
  });

  return (
    <div>
      {/* Header */}
      <div className="section-title">
        📍 Campus Locations
        <button className="primary" style={{ width: 'auto', fontSize: 13, padding: '8px 14px' }} onClick={startNew}>+ Add Location</button>
      </div>

      {err && <div className="alert error" style={{ marginBottom: 12 }}>{err}</div>}
      {msg && <div className="alert success" style={{ marginBottom: 12 }}>{msg}</div>}

      {/* Filters */}
      <div className="row" style={{ marginBottom: 14, gap: 10 }}>
        <input
          type="search" placeholder="Search by name…"
          value={filter} onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 2 }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ flex: 1 }}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>Loading locations…</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Coordinates</th>
                <th>Status</th>
                <th>Version</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No locations found.</td></tr>
              )}
              {filtered.map((loc) => (
                <tr key={loc.locationId}>
                  <td>
                    <strong>{loc.name}</strong>
                    {loc.imageUrl && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>📷</span>}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)' }}>
                    {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                  </td>
                  <td><span className={`badge ${loc.status}`}>{loc.status}</span></td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>v{loc.versionNumber}</td>
                  <td>
                    <div className="actions">
                      <button style={{ fontSize: 13, padding: '5px 10px' }} onClick={() => startEdit(loc)}>Edit</button>
                      <button
                        className={loc.status === 'active' ? 'danger' : 'secondary'}
                        style={{ fontSize: 13, padding: '5px 10px' }}
                        onClick={() => toggleStatus(loc)}
                        disabled={busy}
                      >
                        {loc.status === 'active' ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit/Create Modal */}
      {editing !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'hsl(0,0%,0%,0.5)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-xl)', padding: 28, width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{editing === 'new' ? '📍 Add New Location' : `✏ Edit: ${editing.name}`}</h3>
              <button className="icon" onClick={cancelEdit}>✕</button>
            </div>

            {err && <div className="alert error" style={{ marginBottom: 12 }}>{err}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label>Building Name *
                <input value={form.name} maxLength={150} onChange={setF('name')} placeholder="e.g. Main Block" />
              </label>
              <label>Description
                <textarea value={form.description} maxLength={4000} onChange={setF('description')} placeholder="Brief description of this building/facility…" rows={3} />
              </label>
              <div className="row">
                <label>Latitude *
                  <input type="number" step="any" value={form.latitude} onChange={setF('latitude')} placeholder="13.3225" />
                </label>
                <label>Longitude *
                  <input type="number" step="any" value={form.longitude} onChange={setF('longitude')} placeholder="74.7843" />
                </label>
              </div>
              <label>Building Photo
                <input value={form.imageUrl} onChange={setF('imageUrl')} placeholder="https://… or upload below" />
              </label>
              <div>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={handleImageUpload} />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={imageUploading} style={{ width: '100%' }}>
                  {imageUploading ? '⏳ Uploading…' : '📷 Upload image'}
                </button>
              </div>
              {form.imageUrl && (
                <img src={form.imageUrl} alt="Preview" style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 'var(--r-md)' }} onError={(e) => e.currentTarget.style.display = 'none'} />
              )}

              {/* Confirm nearby */}
              <label style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <input type="checkbox" checked={form.confirmNearby} onChange={setF('confirmNearby')} style={{ width: 'auto' }} />
                Confirm: register even if another building is nearby
              </label>

              <div className="row" style={{ gap: 10, marginTop: 8 }}>
                <button onClick={cancelEdit} disabled={busy}>Cancel</button>
                <button className="primary" onClick={save} disabled={busy || !form.name || !form.latitude || !form.longitude} style={{ flex: 2 }}>
                  {busy ? 'Saving…' : editing === 'new' ? '+ Add Location' : '✓ Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
