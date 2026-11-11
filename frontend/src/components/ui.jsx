import { useEffect, useId, useState } from "react";
import styles from "./admin.module.css";
import { errorMessage } from "./adminUtils";

export const cx = (...a) => a.filter(Boolean).join(" ");
export { styles };

// Live-region message. kind: "ok" | "bad" | undefined
export function Status({ kind, children }) {
  if (!children) return <div className={styles.statusSlot} role="status" />;
  return <div className={cx(styles.status, kind === "ok" && styles.ok, kind === "bad" && styles.bad)} role={kind === "bad" ? "alert" : "status"}>{children}</div>;
}
export const Loading = ({ label = "Loading…" }) => <p className={styles.muted} role="status">{label}</p>;
export function ErrorBlock({ error, onRetry }) {
  return (
    <div className={styles.card} role="alert">
      <strong>{errorMessage(error)}</strong>
      {onRetry && <div style={{ marginTop: 8 }}><button type="button" onClick={onRetry}>Retry</button></div>}
    </div>
  );
}
export const PermissionDenied = () => <div className={styles.card} role="alert"><strong>You do not have permission to view this page.</strong></div>;
export const Empty = ({ children }) => <p className={styles.muted}>{children}</p>;

export function Field({ label, htmlFor, hint, error, children }) {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className={styles.muted}>{hint}</div>}
      {error && <div className={styles.fieldError} role="alert">{error}</div>}
    </div>
  );
}
// Three explicit choices; "Not verified" is stored as null and is never shown as "No".
export function TriStateSelect({ label, value, onChange, disabled }) {
  const id = useId();
  const v = value === null || value === undefined ? "null" : String(value);
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} value={v} disabled={disabled} onChange={(e) => onChange(e.target.value === "null" ? null : e.target.value === "true")}>
        <option value="null">Not verified</option><option value="true">Verified yes</option><option value="false">Verified no</option>
      </select>
    </Field>
  );
}
export const TriTag = ({ label, value }) => (
  <span className={cx(styles.tag, value === true && styles.tagYes, value == null && styles.tagWarn)}>{label}: {value == null ? "Not verified" : value ? "Yes" : "No"}</span>
);
// Two-step button: first click arms it, second click confirms (auto-disarms after 6 s).
export function ConfirmButton({ label, confirmLabel = "Confirm", onConfirm, danger, disabled }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 6000); return () => clearTimeout(t); }, [armed]);
  if (!armed) return <button type="button" className={danger ? styles.danger : undefined} disabled={disabled} onClick={() => setArmed(true)}>{label}</button>;
  return (
    <span className={styles.row}>
      <button type="button" className={danger ? styles.danger : styles.primary} onClick={() => { setArmed(false); onConfirm(); }}>{confirmLabel}</button>
      <button type="button" onClick={() => setArmed(false)}>Cancel</button>
    </span>
  );
}
export function LoadMore({ shown, total, loading, onMore }) {
  if (!total) return null;
  return (
    <div className={styles.row} style={{ marginTop: 8 }}>
      {shown < total && <button type="button" disabled={loading} onClick={onMore}>{loading ? "Loading…" : "Load more"}</button>}
      <span className={styles.muted}>Showing {shown} of {total}</span>
    </div>
  );
}
