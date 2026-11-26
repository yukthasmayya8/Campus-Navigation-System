import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { errorMessage, forgotPassword, resetPassword } from '../api.js';

export default function AdminResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function requestReset(e) {
    e.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      await forgotPassword(email.trim());
      setMessage('If an active account uses that email and outbound email is configured, a reset link will be sent. If no email arrives, contact your system administrator.');
    } catch (err) {
      setError(errorMessage(err));
    } finally { setBusy(false); }
  }

  async function savePassword(e) {
    e.preventDefault();
    setBusy(true); setError(''); setMessage('');
    if (password !== confirmation) {
      setError('The passwords do not match.');
      setBusy(false);
      return;
    }
    try {
      await resetPassword(token, password);
      setMessage('Password updated. You can now sign in with your new password.');
    } catch (err) {
      setError(errorMessage(err));
    } finally { setBusy(false); }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon" aria-hidden="true">🧭</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>SMVITM Navigate</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Administrator password</div>
          </div>
        </div>

        {token ? (
          <form className="stack" onSubmit={savePassword}>
            <div>
              <h2 style={{ fontSize: 22 }}>Choose a new password</h2>
              <p className="muted" style={{ fontSize: 14 }}>Use at least 10 characters, including uppercase, lowercase and a number.</p>
            </div>
            <label htmlFor="new-password">New password
              <input id="new-password" type="password" required minLength={10} maxLength={128}
                autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label htmlFor="confirm-password">Confirm new password
              <input id="confirm-password" type="password" required minLength={10} maxLength={128}
                autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
            </label>
            {error && <div className="alert error" role="alert">{error}</div>}
            {message && <div className="alert info" role="status">{message}</div>}
            {!message && <button type="submit" className="primary" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>}
          </form>
        ) : (
          <form className="stack" onSubmit={requestReset}>
            <div>
              <h2 style={{ fontSize: 22 }}>Reset your password</h2>
              <p className="muted" style={{ fontSize: 14 }}>Enter your administrator email to request a reset link.</p>
            </div>
            <label htmlFor="reset-email">Email address
              <input id="reset-email" type="email" required autoComplete="username"
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            {error && <div className="alert error" role="alert">{error}</div>}
            {message && <div className="alert info" role="status">{message}</div>}
            <button type="submit" className="primary" disabled={busy}>{busy ? 'Requesting…' : 'Send reset link'}</button>
          </form>
        )}

        <div className="login-foot">
          <Link to="/admin/login">← Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
