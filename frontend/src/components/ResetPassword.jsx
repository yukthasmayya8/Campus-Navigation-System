import { useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { adminApi } from "./adminApi";
import { errorMessage, passwordProblems, PASSWORD_RULE_TEXT } from "./adminUtils";
import { Field, Status, styles } from "./ui";

// Opened from the e-mail link: /admin/reset-password?token=...
export default function ResetPassword() {
  const [params] = useSearchParams(), token = params.get("token");
  const a = useId(), b = useId();
  const [n1, setN1] = useState(""), [n2, setN2] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState(false), [msg, setMsg] = useState("");
  if (!token) return <div className={styles.root}><div className={styles.card} role="alert"><strong>This reset link is invalid.</strong> <Link to="/admin/forgot-password">Request a new one</Link></div></div>;
  if (done) return <div className={styles.root}><div className={styles.card} role="status"><strong>Password changed.</strong> <Link to="/admin/login">Sign in</Link></div></div>;
  async function submit(e) {
    e.preventDefault(); setMsg("");
    const p = passwordProblems(n1);
    if (p.length) return setMsg(`New password needs ${p.join(", ")}.`);
    if (n1 !== n2) return setMsg("The two passwords do not match.");
    setBusy(true);
    try { await adminApi.resetPassword({ token, newPassword: n1 }); setDone(true); }
    catch (err) { setMsg(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return (
    <div className={styles.root}>
      <h1>Choose a new password</h1>
      <form onSubmit={submit} noValidate>
        <Field label="New password" htmlFor={a} hint={PASSWORD_RULE_TEXT}><input id={a} type="password" autoComplete="new-password" value={n1} onChange={(e) => setN1(e.target.value)} /></Field>
        <Field label="Repeat new password" htmlFor={b}><input id={b} type="password" autoComplete="new-password" value={n2} onChange={(e) => setN2(e.target.value)} /></Field>
        <button className={styles.primary} disabled={busy || !n1 || !n2}>{busy ? "Saving…" : "Set password"}</button>
      </form>
      <Status kind={msg ? "bad" : undefined}>{msg}</Status>
    </div>
  );
}
