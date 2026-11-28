import { useEffect, useState } from 'react';
import { adminLocationSuggestions, updateLocationSuggestion, approveLocationSuggestion, rejectLocationSuggestion, errorMessage } from '../../api.js';
import { LocationPicker } from '../MapView.jsx';

export default function LocationSuggestionsPanel({ onChange }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setErr('');
    try {
      const data = await adminLocationSuggestions({ status, limit: 100, offset: 0 });
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e) { setErr(errorMessage(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [status]);

  async function approve(s) {
    setBusy(true); setErr(''); setMsg('');
    try {
      await approveLocationSuggestion(s.suggestionId, { confirmNearby: false });
      setMsg(`Approved “${s.name}”. It is now an active location.`);
      await load();
      onChange?.();
    } catch (e) {
      if (e?.code === 'NEARBY_LOCATION') {
        if (window.confirm('A nearby location exists. Approve anyway?')) {
          try {
            await approveLocationSuggestion(s.suggestionId, { confirmNearby: true });
            setMsg(`Approved “${s.name}”.`);
            await load();
            onChange?.();
          } catch (e2) { setErr(errorMessage(e2)); }
        }
      } else setErr(errorMessage(e));
    } finally { setBusy(false); }
  }

  async function reject(s) {
    const notes = window.prompt('Rejection reason (optional):', '') ?? '';
    setBusy(true); setErr(''); setMsg('');
    try {
      await rejectLocationSuggestion(s.suggestionId, { notes });
      setMsg(`Rejected “${s.name}”.`);
      await load();
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      await updateLocationSuggestion(editing.suggestionId, {
        name: editing.name,
        description: editing.description,
        category: editing.category,
        latitude: Number(editing.latitude),
        longitude: Number(editing.longitude),
      });
      setMsg('Suggestion updated.');
      setEditing(null);
      await load();
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <section>
      <div className="section-head">
        <div className="section-title">Suggested missing places</div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>
      {err && <div className="alert error" style={{ marginBottom: 10 }}>{err}</div>}
      {msg && <div className="alert success" style={{ marginBottom: 10 }}>{msg}</div>}
      {loading ? <p className="muted">Loading…</p> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Category</th><th>Coordinates</th><th>Accuracy</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 22 }}>No suggestions.</td></tr>}
              {items.map((s) => (
                <tr key={s.suggestionId}>
                  <td><strong>{s.name}</strong><div className="muted" style={{ fontSize: 12 }}>{s.description}</div></td>
                  <td>{s.category}</td>
                  <td className="mono">{Number(s.latitude).toFixed(5)}, {Number(s.longitude).toFixed(5)}</td>
                  <td>{s.accuracy == null ? '—' : `±${Math.round(s.accuracy)} m`}</td>
                  <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                  <td>
                    <div className="actions">
                      {s.status === 'pending' && (
                        <>
                          <button type="button" onClick={() => setEditing({ ...s, latitude: s.latitude, longitude: s.longitude })} disabled={busy}>Edit</button>
                          <button type="button" className="primary" onClick={() => approve(s)} disabled={busy}>Approve</button>
                          <button type="button" className="danger" onClick={() => reject(s)} disabled={busy}>Reject</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <h3>Edit suggestion</h3>
              <button type="button" className="icon ghost" onClick={() => setEditing(null)}>✕</button>
            </div>
            <div className="modal-body stack">
              <label>Name
                <input value={editing.name} onChange={(e) => setEditing((x) => ({ ...x, name: e.target.value }))} />
              </label>
              <label>Category
                <input value={editing.category} onChange={(e) => setEditing((x) => ({ ...x, category: e.target.value }))} />
              </label>
              <label>Description
                <textarea value={editing.description || ''} onChange={(e) => setEditing((x) => ({ ...x, description: e.target.value }))} />
              </label>
              <div className="row">
                <label>Latitude
                  <input type="number" step="any" value={editing.latitude} onChange={(e) => setEditing((x) => ({ ...x, latitude: e.target.value }))} />
                </label>
                <label>Longitude
                  <input type="number" step="any" value={editing.longitude} onChange={(e) => setEditing((x) => ({ ...x, longitude: e.target.value }))} />
                </label>
              </div>
              <LocationPicker
                value={{ lat: Number(editing.latitude), lng: Number(editing.longitude) }}
                onChange={(v) => setEditing((x) => ({ ...x, latitude: v.lat.toFixed(7), longitude: v.lng.toFixed(7) }))}
                height={220}
              />
            </div>
            <div className="modal-foot">
              <button type="button" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button type="button" className="primary" onClick={saveEdit} disabled={busy}>Save</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
