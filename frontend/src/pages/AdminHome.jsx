import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import TopNav from '../components/TopNav.jsx';
import LocationManager from '../components/admin/LocationManager.jsx';
import LocationSuggestionsPanel from '../components/admin/LocationSuggestionsPanel.jsx';
import RouteManager from '../components/admin/RouteManager.jsx';
import AuditPanel from '../components/admin/AuditPanel.jsx';
import AccountsPanel from '../components/admin/AccountsPanel.jsx';
import { adminLocationsAll, adminRoutesList, errorMessage, logout, me } from '../api.js';

export default function AdminHome() {
  const nav = useNavigate();
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('locations');
  const [stats, setStats] = useState({ activeLocations: 0, activeRoutes: 0, draftRoutes: 0 });
  const [statsKey, setStatsKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const tabsRef = useRef(null);
  const [tabOverflow, setTabOverflow] = useState(false);
  const isSuperAdmin = user?.role === 'super_admin';
  const tabs = [
    { key: 'locations', label: '📍 Locations' },
    { key: 'suggestions', label: '📌 Suggested places' },
    { key: 'routes', label: '🛤️ Routes' },
    ...(isSuperAdmin ? [{ key: 'audit', label: '📋 Audit log' }, { key: 'accounts', label: '👤 Accounts' }] : []),
  ];

  useEffect(() => {
    me()
      .then((data) => {
        const u = data.user ?? data;
        if (u?.role !== 'admin' && u?.role !== 'super_admin') {
          logout().catch(() => {}).finally(() => nav('/', { replace: true }));
          return;
        }
        setUser(u);
      })
      .catch(() => nav('/admin/login', { replace: true }));
  }, [nav]);

  useEffect(() => {
    if (!user) return;
    setLoading(true); setErr('');
    Promise.all([
      adminLocationsAll({ limit: 100, offset: 0 }),
      adminRoutesList({ status: 'active', limit: 1, offset: 0 }),
      adminRoutesList({ status: 'draft', limit: 1, offset: 0 }),
    ]).then(([locations, active, drafts]) => {
      setStats({
        activeLocations: locations.filter((l) => l.status === 'active').length,
        activeRoutes: active.total || 0,
        draftRoutes: drafts.total || 0,
      });
    }).catch((e) => setErr(errorMessage(e))).finally(() => setLoading(false));
  }, [user, statsKey]);

  // Cross-tab / cross-session freshness: other admins (or another tab) can change data.
  useEffect(() => {
    if (!user) return;
    const refresh = () => { if (!document.hidden) setStatsKey((k) => k + 1); };
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVis);
    const id = setInterval(refresh, 45000);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(id);
    };
  }, [user]);

  // Tab strip affordance: detect horizontal overflow and keep the active tab visible.
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const check = () => setTabOverflow(el.scrollWidth - el.clientWidth > 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener('resize', check);
    return () => { ro.disconnect(); window.removeEventListener('resize', check); };
  }, [tabs.length]);

  useEffect(() => {
    tabsRef.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [tab]);

  const refreshStats = () => setStatsKey((k) => k + 1);

  async function handleLogout() {
    await logout().catch(() => {});
    nav('/admin/login', { replace: true });
  }

  if (!user) {
    return (
      <div className="admin-page">
        <TopNav right={<Link to="/" className="navlink">Campus map</Link>} />
        <main className="admin-main"><p className="muted">Checking your session…</p></main>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <TopNav
        right={(
          <div className="row center tight" style={{ alignItems: 'center' }}>
            <span className="muted admin-identity">
              {user.name || user.email}
              {isSuperAdmin && <span className="tag warn">Super Admin</span>}
            </span>
            <Link to="/admin/record" className="navlink">Record</Link>
            <button type="button" onClick={handleLogout} style={{ minHeight: 38 }}>Logout</button>
          </div>
        )}
      />

      <main className="admin-main">
        <h1 className="page-title">Admin dashboard</h1>
        <p className="page-sub">Manage campus buildings, recorded routes, version history{isSuperAdmin ? ', audit logs and administrator accounts' : ''}.</p>

        {err && <div className="alert error" style={{ marginBottom: 14 }}>{err}</div>}

        <div className="stat-cards">
          <div className="stat-card">
            <div className="stat-card-icon">📍</div>
            <div className="stat-card-value">{loading ? '—' : stats.activeLocations}</div>
            <div className="stat-card-label">Active locations</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-icon">🗺️</div>
            <div className="stat-card-value">{loading ? '—' : stats.activeRoutes}</div>
            <div className="stat-card-label">Published routes</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-icon">📝</div>
            <div className="stat-card-value">{loading ? '—' : stats.draftRoutes}</div>
            <div className="stat-card-label">Draft routes</div>
          </div>
        </div>

        <div className={`tabs-wrap${tabOverflow ? ' has-overflow' : ''}`}>
          <div className="tabs" role="tablist" ref={tabsRef}>
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className={`tab${tab === t.key ? ' active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tabOverflow && <span className="tabs-hint" aria-hidden="true">Swipe →</span>}
        </div>

        {tab === 'locations' && <LocationManager user={user} onChange={refreshStats} />}
        {tab === 'suggestions' && <LocationSuggestionsPanel onChange={refreshStats} />}
        {tab === 'routes' && <RouteManager user={user} onChange={refreshStats} />}
        {tab === 'audit' && isSuperAdmin && <AuditPanel />}
        {tab === 'accounts' && isSuperAdmin && <AccountsPanel currentUser={user} />}
      </main>
    </div>
  );
}
