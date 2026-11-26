import { useEffect, useState } from 'react';
import { listUsers, createUser, updateUser, errorMessage } from '../../api.js';
import { Status } from '../ui.jsx';

const EMPTY = { name: '', email: '', role: 'admin', temporaryPassword: '' };

function AccountRow({ account, self, onSaved }) {
  const [form, setForm] = useState({ name: account.name, role: account.role, accountStatus: account.accountStatus });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ kind: '', text: '' });

  useEffect(() => {
    setForm({ name: account.name, role: account.role, accountStatus: account.accountStatus });
  }, [account.name, account.role, account.accountStatus]);

  async function save(e) {
    e.preventDefault();
    setBusy(true); setStatus({ kind: '', text: '' });
    try {
      await updateUser(account.userId, { name: form.name.trim(), role: form.role, accountStatus: form.accountStatus });
      setStatus({ kind: 'ok', text: 'Account saved.' });
      onSaved?.();
    } catch (err) {
      setStatus({ kind: 'bad', text: errorMessage(err) });
    } finally { setBusy(false); }
  }

  return (
    <form className="account-card stack sm" onSubmit={save} aria-label={`Account ${account.email}`}>
      <div className="history-row">
        <strong>{account.email}</strong>
        <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {self && <span className="tag">You</span>}
          {account.forcePasswordChange && <span className="tag warn">Must change password</span>}
          <span className={`badge ${account.accountStatus}`}>{account.accountStatus}</span>
        </span>
      </div>
      <label>Name
        <input required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <div className="row">
        <label>Role
          <select value={form.role} disabled={self} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="admin">Admin</option>
            <option value="super_admin">Super Admin</option>
          </select>
        </label>
        <label>Status
          <select value={form.accountStatus} disabled={self} onChange={(e) => setForm({ ...form, accountStatus: e.target.value })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      </div>
      {self && <p className="muted" style={{ fontSize: 12 }}>You cannot change your own role or status.</p>}
      <div className="row center">
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save account'}</button>
      </div>
      {status.text && <Status kind={status.kind}>{status.text}</Status>}
    </form>
  );
}

export default function AccountsPanel({ currentUser }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [temp, setTemp] = useState(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true); setErr('');
    try { setAccounts(await listUsers()); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setCopied(false);
    try {
      const body = { name: form.name.trim(), email: form.email.trim(), role: form.role };
      if (form.temporaryPassword.trim()) body.temporaryPassword = form.temporaryPassword.trim();
      const res = await createUser(body);
      setTemp({ email: form.email.trim(), password: res.temporaryPassword || form.temporaryPassword.trim() });
      setForm(EMPTY);
      await load();
    } catch (ex) { setErr(errorMessage(ex)); } finally { setBusy(false); }
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <div className="section-title">👤 Administrator accounts</div>
          <div className="muted">Super Admin only. New accounts must change their temporary password at first login.</div>
        </div>
      </div>

      {err && <div className="alert error" style={{ marginBottom: 10 }}>{err}</div>}

      {temp && (
        <div className="panel-card stack sm" role="status" style={{ marginBottom: 12 }}>
          <strong>Temporary password for {temp.email}</strong>
          <div className="temp-password">{temp.password || '(password provided when created)'}</div>
          <p className="muted">Shown only once. Pass it on securely; it cannot be retrieved later.</p>
          <div className="row">
            {navigator.clipboard && (
              <button type="button" onClick={() => navigator.clipboard.writeText(temp.password || '').then(() => setCopied(true)).catch(() => {})}>
                {copied ? 'Copied' : 'Copy password'}
              </button>
            )}
            <button type="button" onClick={() => setTemp(null)}>I have passed it on</button>
          </div>
        </div>
      )}

      <form className="panel-card stack" onSubmit={submit} aria-label="Create administrator">
        <div className="section-title">Create administrator</div>
        <div className="row">
          <label>Name
            <input required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>Email
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
        </div>
        <div className="row">
          <label>Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="admin">Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </label>
          <label>Temporary password (optional)
            <input autoComplete="off" value={form.temporaryPassword} onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })} placeholder="Leave empty to auto-generate" />
          </label>
        </div>
        <button type="submit" className="primary" disabled={busy || !form.name.trim() || !form.email.trim()}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>

      <div style={{ marginTop: 14 }}>
        {loading ? <p className="muted">Loading accounts…</p> : accounts.length === 0 ? <p className="muted">No accounts.</p> : (
          accounts.map((a) => (
            <AccountRow key={a.userId} account={a} self={currentUser?.userId === a.userId} onSaved={load} />
          ))
        )}
      </div>
    </section>
  );
}
