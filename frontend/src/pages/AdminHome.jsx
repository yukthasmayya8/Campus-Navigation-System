import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import TopNav from '../components/TopNav.jsx';
import { me, logout } from '../api.js';

/* Placeholder: proves auth + roles work. Member 4 replaces this with the shared AdminDashboard. */
export default function AdminHome() {
  const nav = useNavigate();
  const [user, setUser] = useState(null); const [err, setErr] = useState('');
  useEffect(() => {
    me().then((d) => setUser(d.user)).catch((e) => { if (e.status === 401) nav('/admin/login'); else setErr(e.message); });
  }, [nav]);
  const out = async () => { try { await logout(); } finally { nav('/admin/login'); } };

  return (
    <div className="page">
      <TopNav right={<button onClick={out}>Log out</button>} />
      <div className="card">
        {err && <div className="alert error">{err}</div>}
        {!user && !err && <p>Loading…</p>}
        {user && (<>
          <h2>Welcome, {user.name}</h2>
          <p>Role: <strong>{user.role === 'super_admin' ? 'Super Admin' : 'Admin'}</strong> · canRestore: <strong>{String(user.canRestore)}</strong></p>
          <p><Link to="/admin/record" className="navlink">Record a route</Link></p>
          <p className="muted">The administration dashboard (location management, route recording, history, accounts) is built by Member 4 against the API.</p>
        </>)}
      </div>
    </div>
  );
}
