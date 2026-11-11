import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../adminApi";
import { useAdminAuth } from "../AuthContext";
import { errorMessage, passwordProblems, PASSWORD_RULE_TEXT } from "../adminUtils";
import { Field, Status, styles } from "../ui";

// forced === true: first login (the server blocks everything else until this succeeds).
export default function ChangePassword({ forced = false }) {
  const { refresh, logout, onApiError } = useAdminAuth();
  const nav = useNavigate(), ids = [useId(), useId(), useId()];
  const [cur, setCur] = useState(""), [n1, setN1] = useState(""), [n2, setN2] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState({ kind: "", text: "" });

  async function submit(e) {
    e.preventDefault(); setMsg({ kind: "", text: "" });
    const p = passwordProblems(n1);
    if (p.length) return setMsg({ kind: "bad", text: `New password needs ${p.join(", ")}.` });
    if (n1 !== n2) return setMsg({ kind: "bad", text: "The two new passwords do not match." });
    if (n1 === cur) return setMsg({ kind: "bad", text: "Choose a password different from the current one." });
    setBusy(true);
    try {
      await adminApi.changePassword({ currentPassword: cur, newPassword: n1 });
      setCur(""); setN1(""); setN2("");
      if (forced) { await refresh(); nav("/admin", { replace: true }); } else setMsg({ kind: "ok", text: "Password changed." });
    } catch (err) {
      // 401 sends the user to login; PASSWORD_CHANGE_REQUIRED is the state we are already in, so still show the message.
      if (!onApiError(err) || err.code === "PASSWORD_CHANGE_REQUIRED") setMsg({ kind: "bad", text: errorMessage(err) });
    } finally { setBusy(false); }
  }
  const body = (
    <>
      <h1>{forced ? "Change your password" : "Change password"}</h1>
      {forced && <p className={styles.muted}>You must choose a new password before you can continue.</p>}
      <form onSubmit={submit} noValidate>
        <Field label={forced ? "Current (temporary) password" : "Current password"} htmlFor={ids[0]}><input id={ids[0]} type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="New password" htmlFor={ids[1]} hint={PASSWORD_RULE_TEXT}><input id={ids[1]} type="password" autoComplete="new-password" value={n1} onChange={(e) => setN1(e.target.value)} /></Field>
        <Field label="Repeat new password" htmlFor={ids[2]}><input id={ids[2]} type="password" autoComplete="new-password" value={n2} onChange={(e) => setN2(e.target.value)} /></Field>
        <div className={styles.row}><button className={styles.primary} disabled={busy || !cur || !n1 || !n2}>{busy ? "Saving…" : "Change password"}</button>{forced && <button type="button" onClick={() => logout().then(() => nav("/admin/login"))}>Log out</button>}</div>
      </form>
      <Status kind={msg.kind || undefined}>{msg.text}</Status>
    </>
  );
  return forced ? <div className={styles.root}>{body}</div> : <div className={styles.card}>{body}</div>;
}
