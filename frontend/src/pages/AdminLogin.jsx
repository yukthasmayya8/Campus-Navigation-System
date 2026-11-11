import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { login, changePassword } from '../api.js';

export default function AdminLogin() {
  const nav = useNavigate();
  const [f, setF]           = useState({ email: '', password: '' });
  const [pw, setPw]         = useState({ next: '' });
  const [mustChange, setMustChange] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [err, setErr]       = useState('');
  const [busy, setBusy]     = useState(false);

  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const { user } = await login(f.email, f.password);
      if (user.forcePasswordChange) setMustChange(true); else nav('/admin');
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }

  async function submitPw(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await changePassword(f.password, pw.next); nav('/admin'); }
    catch (ex) { setErr(ex.details?.[0]?.message || ex.message); } finally { setBusy(false); }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon">🧭</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.3px' }}>SMVITM Navigate</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Administrator Portal</div>
          </div>
        </div>

        {!mustChange ? (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Sign in</h2>
              <p style={{ color: 'var(--muted)', fontSize: 14 }}>Enter your admin credentials below</p>
            </div>

            <label htmlFor="email">
              Email address
              <input
                id="email"
                type="email" required
                autoComplete="username"
                value={f.email}
                onChange={(e) => setF({ ...f, email: e.target.value })}
                placeholder="admin@smvitm.ac.in"
              />
            </label>

            <label htmlFor="password">
              Password
              <div className="pw-toggle">
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={f.password}
                  onChange={(e) => setF({ ...f, password: e.target.value })}
                  placeholder="Enter your password"
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} aria-label="Toggle password visibility">
                  {showPw ? '🙈' : '👁'}
                </button>
              </div>
            </label>

            {err && <div className="alert error">{err}</div>}

            <button id="login-btn" className="primary" type="submit" disabled={busy}>
              {busy ? '⏳ Signing in…' : 'Sign in →'}
            </button>

            <div style={{ textAlign: 'center' }}>
              <Link to="/" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>
                ← Back to campus map
              </Link>
            </div>
          </form>
        ) : (
          <form onSubmit={submitPw} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Set new password</h2>
              <p style={{ color: 'var(--muted)', fontSize: 14 }}>You must change your temporary password before continuing.</p>
            </div>

            <label htmlFor="new-password">
              New password
              <div className="pw-toggle">
                <input
                  id="new-password"
                  type={showNew ? 'text' : 'password'}
                  required minLength={10}
                  autoComplete="new-password"
                  value={pw.next}
                  onChange={(e) => setPw({ next: e.target.value })}
                  placeholder="At least 10 characters"
                />
                <button type="button" onClick={() => setShowNew((v) => !v)} aria-label="Toggle new password visibility">
                  {showNew ? '🙈' : '👁'}
                </button>
              </div>
            </label>
            <p className="muted" style={{ fontSize: 12, margin: '-8px 0' }}>
              Must be at least 10 characters with uppercase, lowercase, and a number.
            </p>

            {err && <div className="alert error">{err}</div>}

            <button id="change-pw-btn" className="primary" type="submit" disabled={busy}>
              {busy ? '⏳ Saving…' : 'Set password & continue →'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
