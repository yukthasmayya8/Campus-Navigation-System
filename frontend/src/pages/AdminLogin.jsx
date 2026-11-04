import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import TopNav from '../components/TopNav.jsx';
import { login, changePassword } from '../api.js';

/* Minimal login so the backend can be exercised. No signup (accounts are created by the Super Admin).
   Member 4 owns the full admin UI, password-reset screens and dashboard. */
export default function AdminLogin() {
  const nav = useNavigate();
  const [f, setF] = useState({ email: '', password: '' });
  const [pw, setPw] = useState({ next: '' });
  const [mustChange, setMustChange] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

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
    <div className="page">
      <TopNav right={<Link to="/" className="navlink">Back to map</Link>} />
      <div className="card">
        {!mustChange ? (
          <form onSubmit={submit}>
            <h2>Administrator login</h2>
            <label>E-mail<input type="email" required autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
            <label>Password<input type="password" required autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
            {err && <div className="alert error">{err}</div>}
            <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
        ) : (
          <form onSubmit={submitPw}>
            <h2>Set a new password</h2>
            <p>You must change your temporary password before continuing.</p>
            <label>New password<input type="password" required minLength={10} autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ next: e.target.value })} /></label>
            <small>At least 10 characters with upper-case, lower-case and a number.</small>
            {err && <div className="alert error">{err}</div>}
            <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
