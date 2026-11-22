import { useEffect, useRef, useState } from 'react';
import { getAuditLogs, errorMessage } from '../../api.js';

const summarize = (value) => {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value.points)) return { ...value, points: `${value.points.length} GPS points` };
  return value;
};

export default function AuditPanel() {
  const [type, setType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState('');
  const seq = useRef(0);

  async function load(reset = true) {
    const mine = ++seq.current;
    if (reset) setLoading(true);
    setErr('');
    try {
      const data = await getAuditLogs({
        entityType: type || undefined,
        entityId: entityId.trim() || undefined,
        limit: reset ? 20 : 20,
        offset: reset ? 0 : items.length,
      });
      if (mine !== seq.current) return;
      setItems((prev) => {
        if (reset) return data.items || [];
        const seen = new Set(prev.map((x) => x.logId));
        return [...prev, ...(data.items || []).filter((x) => !seen.has(x.logId))];
      });
      setTotal(data.total || 0);
    } catch (e) { if (mine === seq.current) setErr(errorMessage(e)); }
    finally { if (mine === seq.current) { setLoading(false); setMore(false); } }
  }

  useEffect(() => { load(true); return () => { seq.current++; }; }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section>
      <div className="section-head">
        <div>
          <div className="section-title">📋 Audit log</div>
          <div className="muted">Who changed what, and when. Super Admin only.</div>
        </div>
      </div>

      <div className="toolbar">
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by entity type">
          <option value="">All types</option>
          <option value="location">Locations</option>
          <option value="route">Routes</option>
          <option value="user">Accounts</option>
        </select>
        <input
          inputMode="numeric"
          placeholder="Entity ID (optional)"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value.replace(/\D/g, ''))}
          aria-label="Filter by entity ID"
        />
        <button type="button" onClick={() => load(true)} style={{ flex: '0 0 auto' }}>Apply</button>
      </div>

      {err && <div className="alert error" style={{ marginBottom: 10 }}>{err}</div>}
      {loading && <p className="muted">Loading audit entries…</p>}
      {!loading && items.length === 0 && !err && <p className="muted">No audit entries found.</p>}

      {items.map((a) => (
        <div className="panel-card" key={a.logId} style={{ marginTop: 10 }}>
          <div className="history-row">
            <strong>{a.action}</strong>
            <span className="muted" style={{ fontSize: 12 }}>{new Date(a.timestamp).toLocaleString()}</span>
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {a.entityType} #{a.entityId ?? '—'} · administrator #{a.administratorId ?? '—'}
          </div>
          {(a.previousData || a.newData) && (
            <details style={{ marginTop: 6 }}>
              <summary>Before / after details</summary>
              <pre className="json">{JSON.stringify({ before: summarize(a.previousData), after: summarize(a.newData) }, null, 2)}</pre>
            </details>
          )}
        </div>
      ))}

      {items.length > 0 && (
        <div className="pager">
          {items.length < total && <button type="button" disabled={more} onClick={() => { setMore(true); load(false); }}>{more ? 'Loading…' : 'Load more'}</button>}
          <span>Showing {items.length} of {total}</span>
        </div>
      )}
    </section>
  );
}
