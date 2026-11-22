import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  adminRoutesList, getRoute, publishRoute, deactivateRoute, reactivateRoute, discardRoute, errorMessage,
} from '../../api.js';
import { formatDistance } from '../../lib/geo.js';
import MapView from '../MapView.jsx';
import HistoryPanel from './HistoryPanel.jsx';

const LIMIT = 15;

export default function RouteManager({ user, onChange }) {
  const [routes, setRoutes] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [page, setPage] = useState(0);
  const [preview, setPreview] = useState(null); // {route, detail}
  const [history, setHistory] = useState(null);

  async function load(pg = page, status = statusFilter) {
    setLoading(true); setErr('');
    try {
      const data = await adminRoutesList({ status: status || undefined, limit: LIMIT, offset: pg * LIMIT });
      setRoutes(data.items || []);
      setTotal(data.total || 0);
    } catch (e) { setErr(errorMessage(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function openPreview(route) {
    setErr(''); setBusy(true);
    try {
      const detail = await getRoute(route.routeId);
      setPreview({ route, detail });
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  async function changeStatus(route, action) {
    if (!window.confirm(`${action === 'publish' ? 'Publish' : action === 'discard' ? 'Discard' : action === 'deactivate' ? 'Deactivate' : 'Reactivate'} “${route.routeName}”?`)) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      if (action === 'publish') await publishRoute(route.routeId, route.versionNumber);
      else if (action === 'deactivate') await deactivateRoute(route.routeId, route.versionNumber);
      else if (action === 'reactivate') await reactivateRoute(route.routeId, route.versionNumber);
      else if (action === 'discard') await discardRoute(route.routeId);
      setMsg(action === 'discard' ? 'Draft discarded.' : `Route ${action === 'publish' ? 'published' : `${action}d`}.`);
      await load();
      onChange?.();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  const filtered = routes.filter((r) => !nameFilter || r.routeName.toLowerCase().includes(nameFilter.trim().toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <section>
      <div className="section-head">
        <div className="section-title">🛤️ Recorded routes</div>
        <Link to="/admin/record" className="navlink" style={{ fontSize: 13 }}>+ Record route</Link>
      </div>

      {err && <div className="alert error" style={{ marginBottom: 10 }}>{err}</div>}
      {msg && <div className="alert success" style={{ marginBottom: 10 }}>{msg}</div>}

      <div className="toolbar">
        <input type="search" placeholder="Search by route name…" value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); load(0, e.target.value); }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {loading ? <p className="muted">Loading routes…</p> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Route</th><th>From → To</th><th>Distance</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 22 }}>No routes found.</td></tr>}
              {filtered.map((r) => (
                <tr key={r.routeId}>
                  <td>
                    <strong>{r.routeName}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {r.directionality === 'bidirectional' ? '↔ Bidirectional' : '→ One-way'}
                      {r.pointCount != null && ` · ${r.pointCount} pts`}{r.reversed ? ' · reverse' : ''}
                    </div>
                  </td>
                  <td className="muted" style={{ fontSize: 12.5 }}>#{r.sourceLocationId} → #{r.destinationLocationId}</td>
                  <td>{formatDistance(r.distanceMeters)}</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                  <td>
                    <div className="actions">
                      <button type="button" onClick={() => openPreview(r)} disabled={busy}>Preview</button>
                      {r.status === 'draft' && (
                        <>
                          <button type="button" className="primary" style={{ width: 'auto' }} onClick={() => changeStatus(r, 'publish')} disabled={busy || (r.pointCount != null && r.pointCount < 2)}>Publish</button>
                          <button type="button" className="danger" onClick={() => changeStatus(r, 'discard')} disabled={busy}>Discard</button>
                        </>
                      )}
                      {r.status === 'active' && <button type="button" className="danger" onClick={() => changeStatus(r, 'deactivate')} disabled={busy}>Deactivate</button>}
                      {r.status === 'inactive' && <button type="button" className="secondary" onClick={() => changeStatus(r, 'reactivate')} disabled={busy}>Reactivate</button>}
                      <button type="button" onClick={() => setHistory(r)}>History</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="pager">
          <button type="button" disabled={page === 0} onClick={() => { setPage(page - 1); load(page - 1); }}>← Prev</button>
          <span>Page {page + 1} of {totalPages}</span>
          <button type="button" disabled={page >= totalPages - 1} onClick={() => { setPage(page + 1); load(page + 1); }}>Next →</button>
        </div>
      )}

      {preview && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setPreview(null); }}>
          <div className="modal wide" role="dialog" aria-modal="true" aria-label={`Preview ${preview.route.routeName}`}>
            <div className="modal-head">
              <div>
                <h3>{preview.route.routeName}</h3>
                <div className="muted">
                  {preview.detail.status === 'draft' ? 'Draft — never visible to the public until published.' : `Status: ${preview.detail.status}`}
                  {preview.detail.distanceMeters != null && ` · ${formatDistance(preview.detail.distanceMeters)} · ${preview.detail.points?.length || 0} points`}
                </div>
              </div>
              <button type="button" className="icon ghost" onClick={() => setPreview(null)} aria-label="Close preview">✕</button>
            </div>
            <div className="modal-body stack">
              <div style={{ height: '48dvh', minHeight: 260, borderRadius: 14, overflow: 'hidden' }}>
                <MapView
                  locations={[]}
                  route={{ ...preview.detail, points: preview.detail.points, waypoints: preview.detail.waypoints }}
                  fit
                  height="100%"
                />
              </div>
              <div className="preview-legend">
                <span className="chip blue">{preview.detail.points?.length || 0} GPS points</span>
                <span className="chip">{preview.detail.waypoints?.length || 0} waypoints</span>
                <span className="chip">{preview.detail.directionality === 'bidirectional' ? 'Bidirectional' : 'One-way'}</span>
                {preview.detail.hasStairs === true && <span className="chip red">Has stairs</span>}
                {preview.detail.hasRamp === true && <span className="chip green">Has ramp</span>}
                {preview.detail.isCovered === true && <span className="chip green">Covered</span>}
              </div>
              {preview.detail.notes && <p className="muted">{preview.detail.notes}</p>}
            </div>
          </div>
        </div>
      )}

      {history && (
        <HistoryPanel
          entityType="route"
          entityId={history.routeId}
          entityName={history.routeName}
          canRestore={Boolean(user?.canRestore)}
          onClose={() => setHistory(null)}
          onChanged={load}
        />
      )}
    </section>
  );
}
