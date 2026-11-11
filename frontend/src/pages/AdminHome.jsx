import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import TopNav from '../components/TopNav.jsx';
import AdminLocationsManager from '../components/AdminLocationsManager.jsx';
import AdminRoutesManager from '../components/AdminRoutesManager.jsx';
import { me, logout, adminLocationsAll, adminRoutesList, listUsers, createUser, updateUser } from '../api.js';

function UsersManager() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ name: '', email: '', role: 'admin', temporaryPassword: '' });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true); setErr('');
    try { setUsers(await listUsers()); } catch (e) { setErr(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  async function addUser(e) {
    e.preventDefault(); setBusy(true); setErr(''); setMsg('');
    try {
      const res = await createUser({ name: form.name.trim(), email: form.email.trim(), role: form.role, temporaryPassword: form.temporaryPassword || undefined });
      setMsg(`User created. Temporary password: ${res.temporaryPassword || '(as provided)'}`);
      setForm({ name: '', email: '', role: 'admin', temporaryPassword: '' });
      await load();
    } catch (ex) { setErr(ex.details?.[0]?.message || ex.message); } finally { setBusy(false); }
  }

  async function toggle(u) {
    const next = u.accountStatus === 'active' ? 'inactive' : 'active';
    if (!window.confirm(`${next === 'active' ? 'Activate' : 'Deactivate'} ${u.email}?`)) return;
    setBusy(true); setErr('');
    try { await updateUser(u.userId, { accountStatus: next }); await load(); } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }

  return (
    <div>
      {err && <div className="alert error" style={{ marginBottom: 12 }}>{err}</div>}
      {msg && <div className="alert success" style={{ marginBottom: 12 }}>{msg}</div>}
      <form onSubmit={addUser} style={{ display: 'grid', gap: 10, marginBottom: 16, maxWidth: 720 }}>
        <div className="row">
          <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        </div>
        <div className="row">
          <label>Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="admin">Admin</option><option value="super_admin">Super Admin</option></select></label>
          <label>Temporary password (optional)<input value={form.temporaryPassword} onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })} placeholder="Leave blank to auto-generate" /></label>
        </div>
        <button className="primary" type="submit" disabled={busy} style={{ width: 'fit-content' }}>Create user</button>
      </form>
      {loading ? <p className="muted">Loading users…</p> : (
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>
          {users.map((u) => (
            <tr key={u.userId}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td><span className="chip blue">{u.role}</span></td>
              <td><span className={`badge ${u.accountStatus}`}>{u.accountStatus}</span></td>
              <td><button onClick={() => toggle(u)} disabled={busy} style={{ fontSize: 12, padding: '5px 10px' }}>{u.accountStatus === 'active' ? 'Deactivate' : 'Activate'}</button></td>
            </tr>
          ))}
        </tbody></table></div>
      )}
    </div>
  );
}

export default function AdminHome() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('locations');
  const [stats, setStats] = useState({
    activeLocations: 0,
    activeRoutes: 0,
    draftRoutes: 0,
  });
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState('');

  /* ── Auth check on mount ─────────────────────────────────────────── */
  useEffect(() => {
    me()
      .then((data) => setUser(data.user ?? data))
      .catch((err) => {
        if (err?.status === 401 || err?.response?.status === 401) {
          navigate('/admin/login');
        } else {
          navigate('/admin/login');
        }
      });
  }, [navigate]);

  /* ── Fetch dashboard stats ───────────────────────────────────────── */
  useEffect(() => {
    if (!user) return;

    setStatsLoading(true);
    setStatsError('');

    Promise.all([
      adminLocationsAll(),
      adminRoutesList({ limit: 100, offset: 0 }),
      adminRoutesList({ status: 'draft', limit: 100, offset: 0 }),
    ])
      .then(([locItems, routePage, draftPage]) => {
        const locations = Array.isArray(locItems) ? locItems : [];
        const routes = Array.isArray(routePage?.items) ? routePage.items : [];
        setStats({
          activeLocations: locations.filter((l) => l.status === 'active').length,
          activeRoutes: routes.filter((r) => r.status === 'active').length || (routePage.total || 0),
          draftRoutes: draftPage?.total ?? routes.filter((r) => r.status === 'draft').length,
        });
      })
      .catch(() => {
        setStatsError('Failed to load dashboard statistics. Please refresh.');
      })
      .finally(() => setStatsLoading(false));
  }, [user]);

  /* ── Logout ──────────────────────────────────────────────────────── */
  const handleLogout = async () => {
    try {
      await logout();
    } catch (_) {
      // ignore errors; redirect regardless
    } finally {
      navigate('/admin/login');
    }
  };

  /* ── Stat cards config ───────────────────────────────────────────── */
  const statCards = [
    {
      key: 'activeLocations',
      label: 'Active Locations',
      value: stats.activeLocations,
      icon: '📍',
    },
    {
      key: 'activeRoutes',
      label: 'Active Routes',
      value: stats.activeRoutes,
      icon: '🗺️',
    },
    {
      key: 'draftRoutes',
      label: 'Draft Routes',
      value: stats.draftRoutes,
      icon: '📝',
    },
  ];

  /* ── Tab config ──────────────────────────────────────────────────── */
  const isSuperAdmin = user?.role === 'super_admin';

  const tabs = [
    { key: 'locations', label: 'Locations' },
    { key: 'routes', label: 'Routes' },
    ...(isSuperAdmin ? [{ key: 'users', label: 'Users' }] : []),
  ];

  /* ── Render ──────────────────────────────────────────────────────── */
  return (
    <>
      <TopNav
        right={(
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {user && (
              <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                {user.name ?? user.email}
                {isSuperAdmin && (
                  <span
                    style={{
                      marginLeft: '0.4rem',
                      fontSize: '0.7rem',
                      background: '#fef3c7',
                      color: '#92400e',
                      padding: '0.1rem 0.4rem',
                      borderRadius: '999px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Super Admin
                  </span>
                )}
              </span>
            )}

            <button
              onClick={handleLogout}
              className="navlink"
              style={{
                cursor: 'pointer',
                padding: '0.4rem 1rem',
                borderRadius: '0.375rem',
                border: '1px solid #e5e7eb',
                background: '#fff',
                color: '#374151',
                fontWeight: 500,
                fontSize: '0.875rem',
              }}
            >
              Logout
            </button>
          </div>
        )}
      />

      <div className="dashboard">
        {/* ── Page header ── */}
        <h1 className="dashboard-title">Admin Dashboard</h1>
        <p className="dashboard-sub">
          Manage campus locations, routes, and system settings for SMVITM Navigation.
        </p>

        {/* ── Stats error ── */}
        {statsError && (
          <div className="alert error" style={{ marginBottom: '1.5rem' }}>
            {statsError}
          </div>
        )}

        {/* ── Stat cards ── */}
        <div className="stat-cards">
          {statCards.map((card) => (
            <div className="stat-card" key={card.key}>
              <div className="stat-card-icon">{card.icon}</div>
              <div className="stat-card-value">
                {statsLoading ? (
                  <span style={{ opacity: 0.4 }}>—</span>
                ) : (
                  card.value
                )}
              </div>
              <div className="stat-card-label">{card.label}</div>
            </div>
          ))}
        </div>

        {/* ── Tab navigation ── */}
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            margin: '2rem 0 1.25rem',
            borderBottom: '2px solid #e5e7eb',
            paddingBottom: '0',
          }}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '0.6rem 1.4rem',
                  border: 'none',
                  borderBottom: isActive ? '2px solid var(--color-primary, #1a56db)' : '2px solid transparent',
                  marginBottom: '-2px',
                  background: 'none',
                  cursor: 'pointer',
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? 'var(--color-primary, #1a56db)' : '#6b7280',
                  fontSize: '0.95rem',
                  transition: 'color 0.15s, border-color 0.15s',
                  borderRadius: '0',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ── Tab panels ── */}
        {activeTab === 'locations' && (
          <section>
            <h2 className="section-title">Locations</h2>
            <AdminLocationsManager user={user} />
          </section>
        )}

        {activeTab === 'routes' && (
          <section>
            <h2 className="section-title">Routes</h2>
            <AdminRoutesManager user={user} />
          </section>
        )}

        {activeTab === 'users' && isSuperAdmin && (
          <section>
            <h2 className="section-title">Users</h2>
            <UsersManager />
          </section>
        )}
      </div>
    </>
  );
}
