import { useCallback, useEffect, useRef, useState } from 'react';
import { compareVersions, getAdminLocation, getRoute, getVersions, restoreVersion, errorMessage } from '../../api.js';
import { Loading, Status } from '../ui.jsx';

const PAGE = 10;

const labelFor = (field) => String(field)
  .replace(/([A-Z])/g, ' $1')
  .replace(/[_-]+/g, ' ')
  .replace(/^\w/, (c) => c.toUpperCase())
  .trim();

const formatValue = (field, value) => {
  if (value === null || value === undefined) return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return field === 'points' ? `${value.length} GPS points` : `${value.length} item(s)`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/**
 * Version history + comparison + restore for one location or route.
 * Restore is only offered when the signed-in user has `canRestore` (Super Admin).
 */
export default function HistoryPanel({ entityType, entityId, entityName, canRestore = false, onClose, onChanged }) {
  const [versions, setVersions] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [moreBusy, setMoreBusy] = useState(false);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [diff, setDiff] = useState({ status: 'idle', changes: [], error: '' });
  const [restoring, setRestoring] = useState(null);
  const [restoreMsg, setRestoreMsg] = useState({ kind: '', text: '' });
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setStatus('loading'); setError('');
    try {
      const res = await getVersions(entityType, entityId, { limit: PAGE, offset: 0 });
      if (mine !== seq.current) return;
      const items = res.items || [];
      setVersions(items);
      setTotal(res.total || 0);
      setStatus('success');
      const newest = items[0]?.versionNumber || 0;
      setTo(newest);
      setFrom(Math.max(1, newest - 1));
    } catch (e) {
      if (mine === seq.current) { setError(errorMessage(e)); setStatus('error'); }
    }
  }, [entityType, entityId]);

  useEffect(() => { load(); return () => { seq.current++; }; }, [load]);

  async function loadMore() {
    setMoreBusy(true); setError('');
    try {
      const res = await getVersions(entityType, entityId, { limit: PAGE, offset: versions.length });
      setVersions((prev) => {
        const seen = new Set(prev.map((v) => v.versionNumber));
        return [...prev, ...(res.items || []).filter((v) => !seen.has(v.versionNumber))];
      });
      setTotal(res.total || 0);
    } catch (e) { setError(errorMessage(e)); } finally { setMoreBusy(false); }
  }

  async function runCompare() {
    if (from === to) return;
    setDiff({ status: 'loading', changes: [], error: '' });
    try {
      const res = await compareVersions(entityType, entityId, from, to);
      setDiff({ status: 'done', changes: res.changes || [], error: '' });
    } catch (e) { setDiff({ status: 'error', changes: [], error: errorMessage(e) }); }
  }

  async function doRestore(versionNumber) {
    setRestoring(versionNumber); setRestoreMsg({ kind: '', text: '' });
    try {
      const current = entityType === 'route' ? await getRoute(entityId) : await getAdminLocation(entityId);
      const res = await restoreVersion(entityType, entityId, versionNumber, current.versionNumber);
      setRestoreMsg({ kind: 'ok', text: `Restored version ${versionNumber} as version ${res.versionNumber ?? '—'}. Status: ${res.status || 'unchanged'}.` });
      await load();
      onChanged?.();
      setDiff({ status: 'idle', changes: [], error: '' });
    } catch (e) {
      setRestoreMsg({ kind: 'bad', text: errorMessage(e) });
    } finally { setRestoring(null); }
  }

  const options = versions.map((v) => v.versionNumber).sort((a, b) => a - b);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label={`Version history for ${entityName || entityId}`}>
        <div className="modal-head">
          <div>
            <h3>Version history</h3>
            <div className="muted">{entityType === 'route' ? 'Route' : 'Location'}: {entityName || `#${entityId}`}</div>
          </div>
          <button type="button" className="icon ghost" onClick={onClose} aria-label="Close history">✕</button>
        </div>

        <div className="modal-body stack">
          {status === 'loading' && <Loading label="Loading versions…" />}
          {status === 'error' && (
            <div className="stack sm">
              <div className="alert error">{error}</div>
              <button type="button" onClick={load}>Try again</button>
            </div>
          )}

          {status === 'success' && versions.length === 0 && <p className="muted">No versions recorded yet.</p>}

          {status === 'success' && versions.length > 0 && (
            <>
              <ol className="history-list">
                {versions.map((v, i) => (
                  <li className="history-item" key={v.versionNumber}>
                    <div className="history-row">
                      <strong>Version {v.versionNumber}</strong>
                      {i === 0 && <span className="tag">Current</span>}
                    </div>
                    <div className="history-meta">
                      {new Date(v.modifiedAt).toLocaleString()} · {v.modifiedByName || 'Unknown administrator'}
                    </div>
                    <div className="history-desc">{v.changeDescription || 'No change description.'}</div>
                    {canRestore && i !== 0 && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={restoring != null}
                        onClick={() => {
                          if (window.confirm(`Restore ${entityName || entityType} to version ${v.versionNumber}? This creates a new version and keeps history.`)) doRestore(v.versionNumber);
                        }}
                      >
                        {restoring === v.versionNumber ? 'Restoring…' : `Restore v${v.versionNumber}`}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
              {versions.length < total && (
                <button type="button" onClick={loadMore} disabled={moreBusy}>{moreBusy ? 'Loading…' : `Load older versions (${total - versions.length})`}</button>
              )}
              {error && <div className="alert error">{error}</div>}
              {restoreMsg.text && <Status kind={restoreMsg.kind}>{restoreMsg.text}</Status>}
            </>
          )}

          {status === 'success' && versions.length > 1 && (
            <div className="panel-card stack sm">
              <div className="section-title">Compare versions</div>
              <div className="row">
                <label>From
                  <select value={from} onChange={(e) => { setFrom(Number(e.target.value)); setDiff({ status: 'idle', changes: [], error: '' }); }}>
                    {options.map((n) => <option key={n} value={n}>Version {n}</option>)}
                  </select>
                </label>
                <label>To
                  <select value={to} onChange={(e) => { setTo(Number(e.target.value)); setDiff({ status: 'idle', changes: [], error: '' }); }}>
                    {options.map((n) => <option key={n} value={n}>Version {n}</option>)}
                  </select>
                </label>
              </div>
              {from === to && <p className="muted">Pick two different versions.</p>}
              <button type="button" onClick={runCompare} disabled={from === to || diff.status === 'loading'}>
                {diff.status === 'loading' ? 'Comparing…' : 'Compare'}
              </button>
              {diff.status === 'error' && <div className="alert error">{diff.error}</div>}
              {diff.status === 'done' && diff.changes.length === 0 && <p className="muted">No differences.</p>}
              {diff.status === 'done' && diff.changes.length > 0 && (
                <ul className="history-list">
                  {diff.changes.map((c) => (
                    <li className="history-item" key={c.field}>
                      <strong>{labelFor(c.field)}</strong>
                      <div className="diff" style={{ marginTop: 4 }}>
                        <span className="old">{formatValue(c.field, c.from)}</span>
                        <span aria-hidden="true">→</span>
                        <span className="new">{formatValue(c.field, c.to)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
