import { useEffect, useId, useState } from 'react';
import { errorMessage } from '../api.js';

export const cx = (...a) => a.filter(Boolean).join(' ');
const styles = {
  row: 'row', card: 'panel-card', muted: 'muted', field: 'stack sm', fieldError: 'search-note error',
  status: 'status', ok: 'ok', bad: 'bad', statusSlot: 'status-slot', tag: 'tag', tagYes: 'chip green',
  tagWarn: 'chip amber', primary: 'primary', danger: 'danger', pre: 'json',
};

export { styles };

/** Live-region message. kind: "ok" | "bad" | undefined */
export function Status({ kind, children }) {
  if (!children) return <div className="status-slot" role="status" />;
  return <div className={`status${kind ? ` ${kind}` : ''}`} role={kind === 'bad' ? 'alert' : 'status'}>{children}</div>;
}

export const Loading = ({ label = 'Loading…' }) => <p className="muted" role="status">{label}</p>;

export function ErrorBlock({ error, onRetry }) {
  return (
    <div className="panel-card" role="alert">
      <strong>{errorMessage(error)}</strong>
      {onRetry && <div style={{ marginTop: 8 }}><button type="button" onClick={onRetry}>Retry</button></div>}
    </div>
  );
}

export const PermissionDenied = () => <div className="panel-card" role="alert"><strong>You do not have permission to view this page.</strong></div>;
export const Empty = ({ children }) => <p className="muted">{children}</p>;

export function Field({ label, htmlFor, hint, error, children }) {
  return (
    <div className="stack sm">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="muted" style={{ fontSize: 12 }}>{hint}</div>}
      {error && <div className="search-note error" role="alert">{error}</div>}
    </div>
  );
}

/** Three explicit choices; "Not verified" is stored as null and never shown as "No". */
export function TriStateSelect({ label, value, onChange, disabled, id }) {
  const auto = useId();
  const fieldId = id || auto;
  const v = value === null || value === undefined ? 'null' : String(value);
  return (
    <Field label={label} htmlFor={fieldId}>
      <select id={fieldId} value={v} disabled={disabled} onChange={(e) => onChange(e.target.value === 'null' ? null : e.target.value === 'true')}>
        <option value="null">Not verified</option>
        <option value="true">Verified yes</option>
        <option value="false">Verified no</option>
      </select>
    </Field>
  );
}

export const TriTag = ({ label, value }) => (
  <span className={cx('chip', value === true && 'green', value == null && 'amber')}>
    {label}: {value == null ? 'Not verified' : value ? 'Yes' : 'No'}
  </span>
);

/** Two-step button: first click arms it, second confirms (auto-disarms after 6 s). */
export function ConfirmButton({ label, confirmLabel = 'Confirm', onConfirm, danger, disabled }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(t);
  }, [armed]);
  if (!armed) return <button type="button" className={danger ? 'danger' : undefined} disabled={disabled} onClick={() => setArmed(true)}>{label}</button>;
  return (
    <span className="row tight">
      <button type="button" className={danger ? 'danger' : 'primary'} onClick={() => { setArmed(false); onConfirm(); }}>{confirmLabel}</button>
      <button type="button" onClick={() => setArmed(false)}>Cancel</button>
    </span>
  );
}

export function LoadMore({ shown, total, loading, onMore }) {
  if (!total) return null;
  return (
    <div className="row center" style={{ marginTop: 10 }}>
      {shown < total && <button type="button" disabled={loading} onClick={onMore}>{loading ? 'Loading…' : 'Load more'}</button>}
      <span className="muted">Showing {shown} of {total}</span>
    </div>
  );
}
