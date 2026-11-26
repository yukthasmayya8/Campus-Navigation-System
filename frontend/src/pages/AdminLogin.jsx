import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { changePassword, errorMessage, login, logout, me } from '../api.js';

export default function AdminLogin() {
  const nav = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [next, setNext] = useState('');
  const [mustChange, setMustChange] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    me().then(({ user }) => {
      if ((user?.role === 'admin' || user?.role === 'super_admin') && !user.forcePasswordChange) nav('/admin', { replace: true });
      else if (user && user.role !== 'admin' && user.role !== 'super_admin') {
        logout().catch(() => {}).finally(() => {
          try { sessionStorage.setItem('campus-nav-notice', 'Admin sign-in is for campus staff. You are on the public campus map — no account is needed to search routes or navigate.'); } catch { /* ignore */ }
          nav('/', { replace: true });
        });
      }
    }).catch(() => { /* not signed in */ });
  }, [nav]);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const { user } = await login(form.email, form.password);
      if (user.role !== 'admin' && user.role !== 'super_admin') {
        await logout().catch(() => {});
        try { sessionStorage.setItem('campus-nav-notice', 'Admin sign-in is for campus staff. You are on the public campus map — no account is needed to search routes or navigate.'); } catch { /* ignore */ }
    nav('/', { replace: true });
        return;
      }
      if (user.forcePasswordChange) setMustChange(true);
      else nav('/admin', { replace: true });
    } catch (ex) {
      if (ex?.status === 401 || ex?.status === 403) {
        await logout().catch(() => {});
        try { sessionStorage.setItem('campus-nav-notice', 'Admin sign-in is for campus staff. You are on the public campus map — no account is needed to search routes or navigate.'); } catch { /* ignore */ }
    nav('/', { replace: true });
        return;
      }
      setErr(errorMessage(ex));
    } finally { setBusy(false); }
  }

  async function submitPassword(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await changePassword(form.password, next);
      nav('/admin', { replace: true });
    } catch (ex) { setErr(errorMessage(ex)); } finally { setBusy(false); }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon" aria-hidden="true">🧭</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>SMVITM Navigate</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Administrator portal</div>
          </div>
        </div>

        {!mustChange ? (
          <form className="stack" onSubmit={submit}>
            <div>
              <h2 style={{ fontSize: 22 }}>Sign in</h2>
              <p className="muted" style={{ fontSize: 14 }}>Use your campus administrator credentials.</p>
            </div>

            <label htmlFor="email">Email address
              <input id="email" type="email" required autoComplete="username" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="admin@smvitm.ac.in" />
            </label>

            <label htmlFor="password">Password
              <div className="pw-toggle">
                <input id="password" type={showPw ? 'text' : 'password'} required autoComplete="current-password"
                  value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Enter your password" />
                <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw ? '🙈' : '👁'}
                </button>
              </div>
            </label>

            {err && <div className="alert error" role="alert">{err}</div>}

            <button type="submit" className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in →'}</button>

            <div className="login-foot">
              <Link to="/admin/reset-password">Forgot password?</Link>
              <br />
              <Link to="/">← Back to campus map</Link>
            </div>
          </form>
        ) : (
          <form className="stack" onSubmit={submitPassword}>
            <div>
              <h2 style={{ fontSize: 22 }}>Set a new password</h2>
              <p className="muted" style={{ fontSize: 14 }}>Your temporary password must be changed before you can continue.</p>
            </div>

            <label htmlFor="new-password">New password
              <div className="pw-toggle">
                <input id="new-password" type={showNext ? 'text' : 'password'} required minLength={10}
                  autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 10 characters" />
                <button type="button" onClick={() => setShowNext((v) => !v)} aria-label={showNext ? 'Hide password' : 'Show password'}>
                  {showNext ? '🙈' : '👁'}
                </button>
              </div>
            </label>
            <p className="muted" style={{ fontSize: 12, marginTop: -8 }}>At least 10 characters with uppercase, lowercase and a number.</p>

            {err && <div className="alert error" role="alert">{err}</div>}

            <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Set password & continue →'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
