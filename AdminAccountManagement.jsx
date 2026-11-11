import { useCallback, useEffect, useId, useState } from "react";
import { adminApi, items, normUser } from "../adminApi";
import { useAdminAuth } from "../AuthContext";
import { errorMessage } from "../adminUtils";
import { Field, Loading, ErrorBlock, Empty, Status, styles } from "../ui";

// Super Admin only. The temporary password is returned by the server once: show it once, then it is gone.
export default function AdminAccountManagement() {
  const { user: me, isSuperAdmin, onApiError } = useAdminAuth();
  const [state, setState] = useState({ list: [], loading: true, error: null });
  const [temp, setTemp] = useState(null), [copied, setCopied] = useState(false);
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try { setState({ list: items(await adminApi.listUsers()).map(normUser), loading: false, error: null }); }
    catch (e) { if (!onApiError(e)) setState((s) => ({ ...s, loading: false, error: e })); }
  }, [onApiError]);
  useEffect(() => { load(); }, [load]);
  if (!isSuperAdmin) return <div className={styles.card} role="alert"><strong>You do not have permission to view this page.</strong></div>;
  return (
    <div>
      {temp && (
        <div className={styles.card} role="status">
          <strong>Temporary password for {temp.email}</strong>
          <div className={styles.temp}>{temp.password}</div>
          <p className={styles.muted}>Shown only once. Pass it to the new administrator securely. They must change it at first login.</p>
          <div className={styles.row}>
            {navigator.clipboard && <button type="button" onClick={() => navigator.clipboard.writeText(temp.password).then(() => setCopied(true)).catch(() => {})}>{copied ? "Copied" : "Copy"}</button>}
            <button type="button" onClick={() => { setTemp(null); setCopied(false); }}>I have passed it on</button>
          </div>
        </div>
      )}
      <CreateUser onCreated={(email, password) => { setTemp(email && password ? { email, password } : null); setCopied(false); load(); }} />
      {state.loading && <Loading />}
      {state.error && <ErrorBlock error={state.error} onRetry={load} />}
      {!state.loading && !state.error && !state.list.length && <Empty>No accounts.</Empty>}
      {state.list.map((u) => <UserRow key={u.id} u={u} self={me && u.id === me.id} onSaved={load} />)}
    </div>
  );
}
function CreateUser({ onCreated }) {
  const { onApiError } = useAdminAuth(), ids = [useId(), useId(), useId(), useId()];
  const [f, setF] = useState({ name: "", email: "", role: "admin", temporaryPassword: "" }), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  async function submit(e) {
    e.preventDefault(); setBusy(true); setMsg("");
    try {
      const body = { name: f.name.trim(), email: f.email.trim(), role: f.role };
      if (f.temporaryPassword.trim()) body.temporaryPassword = f.temporaryPassword.trim();
      const r = await adminApi.createUser(body);
      onCreated(f.email.trim(), (r && r.temporaryPassword) || f.temporaryPassword.trim() || null);
      setF({ name: "", email: "", role: "admin", temporaryPassword: "" });
    } catch (err) { if (!onApiError(err)) setMsg(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return (
    <form className={styles.card} onSubmit={submit} aria-label="Create administrator">
      <h3>Create administrator</h3>
      <Field label="Name" htmlFor={ids[0]}><input id={ids[0]} required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Email" htmlFor={ids[1]}><input id={ids[1]} type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Role" htmlFor={ids[2]}><select id={ids[2]} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="admin">Admin</option><option value="super_admin">Super Admin</option></select></Field>
      <Field label="Temporary password (optional)" htmlFor={ids[3]} hint="Leave empty to have the server generate one."><input id={ids[3]} autoComplete="off" value={f.temporaryPassword} onChange={(e) => setF({ ...f, temporaryPassword: e.target.value })} /></Field>
      <button className={styles.primary} disabled={busy || !f.name || !f.email}>{busy ? "Creating…" : "Create account"}</button>
      <Status kind={msg ? "bad" : undefined}>{msg}</Status>
    </form>
  );
}
function UserRow({ u, self, onSaved }) {
  const { onApiError } = useAdminAuth(), ids = [useId(), useId(), useId()];
  const [f, setF] = useState({ name: u.name, role: u.role, accountStatus: u.accountStatus }), [busy, setBusy] = useState(false), [msg, setMsg] = useState({ kind: "", text: "" });
  useEffect(() => { setF({ name: u.name, role: u.role, accountStatus: u.accountStatus }); }, [u.name, u.role, u.accountStatus]);
  async function save(e) {
    e.preventDefault(); setBusy(true); setMsg({ kind: "", text: "" });
    try { await adminApi.updateUser(u.id, { name: f.name.trim(), role: f.role, accountStatus: f.accountStatus }); setMsg({ kind: "ok", text: "Saved." }); onSaved(); }
    catch (err) { if (!onApiError(err)) setMsg({ kind: "bad", text: errorMessage(err) }); } // e.g. LAST_SUPER_ADMIN, cannot demote yourself
    finally { setBusy(false); }
  }
  return (
    <form className={styles.card} onSubmit={save} aria-label={`Account ${u.email}`}>
      <strong>{u.email}</strong> {self && <span className={styles.tag}>you</span>} {u.forcePasswordChange && <span className={`${styles.tag} ${styles.tagWarn}`}>must change password</span>}
      <Field label="Name" htmlFor={ids[0]}><input id={ids[0]} required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className={styles.row}>
        <Field label="Role" htmlFor={ids[1]}><select id={ids[1]} value={f.role} disabled={self} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="admin">Admin</option><option value="super_admin">Super Admin</option></select></Field>
        <Field label="Status" htmlFor={ids[2]}><select id={ids[2]} value={f.accountStatus} disabled={self} onChange={(e) => setF({ ...f, accountStatus: e.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
      </div>
      {self && <p className={styles.muted}>You cannot change your own role or status.</p>}
      <button className={styles.primary} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      <Status kind={msg.kind || undefined}>{msg.text}</Status>
    </form>
  );
}
