import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../adminApi";
import { errorMessage } from "../adminUtils";
import { Field, Status, styles } from "../ui";

const GENERIC = "If an account exists for that e-mail, a reset link has been sent.";
// The server always answers with the same message; this page never says whether an account exists.
export default function ForgotPassword() {
  const id = useId();
  const [email, setEmail] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState({ kind: "", text: "" });
  async function submit(e) {
    e.preventDefault(); setBusy(true); setMsg({ kind: "", text: "" });
    try { const r = await adminApi.forgotPassword(email.trim()); setMsg({ kind: "ok", text: (r && r.message) || GENERIC }); }
    catch (err) { setMsg({ kind: "bad", text: err.status === 429 || err.code === "NETWORK" ? errorMessage(err) : GENERIC }); }
    finally { setBusy(false); }
  }
  return (
    <div className={styles.root}>
      <h1>Forgot password</h1>
      <p className={styles.muted}>Enter your e-mail address and we will send a reset link if an account exists.</p>
      <form onSubmit={submit}>
        <Field label="Email" htmlFor={id}><input id={id} type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <div className={styles.row}><button className={styles.primary} disabled={busy || !email}>{busy ? "Sending…" : "Send reset link"}</button><Link className={styles.btn} to="/admin/login">Back to login</Link></div>
      </form>
      <Status kind={msg.kind || undefined}>{msg.text}</Status>
    </div>
  );
}
