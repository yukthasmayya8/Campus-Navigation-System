import { useEffect, useId, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { adminApi } from "./adminApi";
import { useAdminAuth } from "./AuthContext";
import { errorMessage } from "./adminUtils";
import { Field, Status, Loading, styles } from "./ui";

// No signup anywhere: only accounts created by the Super Admin can sign in.
export default function AdminLogin() {
  const { status, refresh } = useAdminAuth();
  const nav = useNavigate(), loc = useLocation();
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const eid = useId(), pid = useId();
  useEffect(() => { document.title = "Administrator login"; }, []);
  if (status === "loading") return <div className={styles.root}><Loading /></div>;
  if (status === "authenticated") return <Navigate to={(loc.state && loc.state.from) || "/admin"} replace />;
  if (status === "passwordChange") return <Navigate to="/admin/change-password" replace />;

  async function submit(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await adminApi.login(email.trim(), password);
      const u = await refresh();
      if (!u) setError("Signed in, but the session could not be read. Please try again.");
      else nav(u.forcePasswordChange ? "/admin/change-password" : (loc.state && loc.state.from) || "/admin", { replace: true });
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return (
    <div className={styles.root}>
      <h1>Administrator login</h1>
      <p className={styles.muted}>Only accounts created by the Super Admin can sign in. There is no public signup.</p>
      <form onSubmit={submit} noValidate>
        <Field label="Email" htmlFor={eid}><input id={eid} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" htmlFor={pid}><input id={pid} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <div className={styles.row}><button className={styles.primary} disabled={busy || !email || !password}>{busy ? "Signing in…" : "Sign in"}</button><Link className={styles.btn} to="/">Back to map</Link></div>
      </form>
      <Status kind={error ? "bad" : undefined}>{error}</Status>
      <p><Link to="/admin/forgot-password">Forgot password?</Link></p>
    </div>
  );
}
