import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { me, logout } from '../api.js';

/**
 * Protect admin/super-admin pages. Unauthenticated -> /admin/login.
 * Authenticated but not an admin role -> logout and return to public app.
 */
export default function RequireAdmin({ children }) {
  const [state, setState] = useState({ loading: true, ok: false, to: null });
  const loc = useLocation();

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await me();
        const user = data.user ?? data;
        const role = user?.role;
        if (role === 'admin' || role === 'super_admin') {
          if (mounted) setState({ loading: false, ok: true, to: null });
        } else {
          try { await logout(); } catch {}
          if (mounted) setState({ loading: false, ok: false, to: '/' });
        }
      } catch {
        if (mounted) setState({ loading: false, ok: false, to: '/admin/login' });
      }
    })();
    return () => { mounted = false; };
  }, [loc.pathname]);

  if (state.loading) {
    return (
      <div className="page" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div className="muted">Checking session…</div>
      </div>
    );
  }
  if (!state.ok) {
    if (state.to === '/') return <Navigate to="/" replace />;
    return <Navigate to="/admin/login" replace state={{ from: loc.pathname + loc.search }} />;
  }
  return children;
}
