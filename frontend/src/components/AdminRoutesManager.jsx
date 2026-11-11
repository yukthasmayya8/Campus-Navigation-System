import { useEffect, useState } from 'react';
import {
  adminRoutesList, getRoute, deactivateRoute, reactivateRoute,
  getRouteVersions, restoreRoute,
} from '../api.js';
import { Link } from 'react-router-dom';

function formatDist(m) {
  if (!m && m !== 0) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export default function AdminRoutesManager({ user }) {
  const [routes, setRoutes]         = useState([]);
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(true);
  const [err, setErr]               = useState('');
  const [msg, setMsg]               = useState('');
  const [busy, setBusy]             = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [nameFilter, setNameFilter]     = useState('');
  const [page, setPage]             = useState(0);
  const [versioning, setVersioning] = useState(null);  // {route, versions}
  const LIMIT = 15;

  const load = async (pg = page, st = statusFilter) => {
    setLoading(true); setErr('');
    try {
      const d = await adminRoutesList({ status: st || undefined, limit: LIMIT, offset: pg * LIMIT });
      setRoutes(d.items); setTotal(d.total);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  async function handleStatusChange(route, action) {
    if (!window.confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} route "${route.routeName}"?`)) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      if (action === 'deactivate') await deactivateRoute(route.routeId, route.versionNumber);
      else if (action === 'reactivate') await reactivateRoute(route.routeId, route.versionNumber);
      setMsg(`Route ${action}d.`);
      await load();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }

  async function openVersions(route) {
    setErr('');
    try {
      const d = await getRouteVersions(route.routeId);
      setVersioning({ route, versions: d.items });
    } catch (ex) { setErr(ex.message); }
  }

  async function doRestore(route, versionNumber) {
    if (!window.confirm(`Restore route to version ${versionNumber}? This will create a new version.`)) return;
    setBusy(true); setErr('');
    try {
      const current = await getRoute(route.routeId);
      await restoreRoute(route.routeId, versionNumber, current.versionNumber);
      setMsg(`Route restored to v${versionNumber}.`);
      setVersioning(null); await load();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }

  const filtered = routes.filter((r) => !nameFilter || r.routeName.toLowerCase().includes(nameFilter.toLowerCase()));
  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div>
      <div className="section-title">
        🛤️ Routes
        <Link to="/admin/record" className="navlink" style={{ fontSize: 13, padding: '7px 14px' }}>+ Record New Route</Link>
      </div>

      {err && <div className="alert error" style={{ marginBottom: 12 }}>{err}</div>}
      {msg && <div className="alert success" style={{ marginBottom: 12 }}>{msg}</div>}

      {/* Filters */}
      <div className="row" style={{ marginBottom: 14, gap: 10 }}>
        <input
          type="search" placeholder="Search by route name…"
          value={nameFilter} onChange={(e) => setNameFilter(e.target.value)}
          style={{ flex: 2 }}
        />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); load(0, e.target.value); }} style={{ flex: 1 }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>Loading routes…</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Route Name</th>
                <th>From → To</th>
                <th>Distance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No routes found.</td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.routeId}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{r.routeName}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      {r.directionality === 'bidirectional' ? '↔ Bidirectional' : '→ One-way'}
                      {r.pointCount != null && ` · ${r.pointCount} pts`}
                    </div>
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--muted)' }}>
                    #{r.sourceLocationId} → #{r.destinationLocationId}
                  </td>
                  <td style={{ fontSize: 13 }}>{formatDist(r.distanceMeters)}</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                  <td>
                    <div className="actions">
                      {r.status === 'active' && (
                        <button className="danger" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => handleStatusChange(r, 'deactivate')} disabled={busy}>
                          Deactivate
                        </button>
                      )}
                      {r.status === 'inactive' && (
                        <button className="secondary" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => handleStatusChange(r, 'reactivate')} disabled={busy}>
                          Reactivate
                        </button>
                      )}
                      {user?.canRestore && (
                        <button style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => openVersions(r)}>
                          History
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 14 }}>
          <button disabled={page === 0} onClick={() => { setPage(page - 1); load(page - 1); }}>← Prev</button>
          <span style={{ padding: '10px 14px', fontSize: 14, color: 'var(--muted)' }}>Page {page + 1} of {totalPages}</span>
          <button disabled={page >= totalPages - 1} onClick={() => { setPage(page + 1); load(page + 1); }}>Next →</button>
        </div>
      )}

      {/* Version History / Restore Modal */}
      {versioning && (
        <div style={{ position: 'fixed', inset: 0, background: 'hsl(0,0%,0%,0.5)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-xl)', padding: 28, width: 'min(600px, 100%)', maxHeight: '85vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>📜 Version History: {versioning.route.routeName}</h3>
              <button className="icon" onClick={() => setVersioning(null)}>✕</button>
            </div>

            {versioning.versions.length === 0 && <p className="muted">No version history.</p>}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Changed</th>
                    <th>Description</th>
                    {user?.canRestore && <th>Restore</th>}
                  </tr>
                </thead>
                <tbody>
                  {versioning.versions.map((v) => (
                    <tr key={v.versionNumber}>
                      <td><span className="chip blue">v{v.versionNumber}</span></td>
                      <td style={{ fontSize: 13, color: 'var(--muted)' }}>
                        {new Date(v.modifiedAt).toLocaleString()}
                        {v.modifiedByName && <div style={{ fontSize: 12 }}>by {v.modifiedByName}</div>}
                      </td>
                      <td style={{ fontSize: 13 }}>{v.changeDescription || '—'}</td>
                      {user?.canRestore && (
                        <td>
                          <button
                            className="secondary"
                            style={{ fontSize: 12, padding: '5px 10px' }}
                            onClick={() => doRestore(versioning.route, v.versionNumber)}
                            disabled={busy}
                          >
                            Restore
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
