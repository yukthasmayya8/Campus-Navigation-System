import { useEffect, useMemo, useState } from "react";
import { adminApi, items, normLocation } from "../adminApi";
import { useAdminAuth } from "../AuthContext";
import { errorMessage, isConflict } from "../adminUtils";
import { Loading, ErrorBlock, Empty, Status, ConfirmButton, styles } from "../ui";
import LocationForm from "./LocationForm";

// List (including inactive), filter, register, edit/correct coordinates, deactivate/reactivate. There is no delete.
export default function LocationManagement() {
  const { onApiError } = useAdminAuth();
  const [filters, setFilters] = useState({ status: "", q: "" }), [q, setQ] = useState("");
  const [state, setState] = useState({ list: [], loading: true, error: null }), [all, setAll] = useState([]);
  const [editing, setEditing] = useState(undefined); // undefined = list, null = new, object = edit
  const [msg, setMsg] = useState({ kind: "", text: "" }), [rev, setRev] = useState(0), [busyId, setBusyId] = useState(null);

  useEffect(() => { const t = setTimeout(() => setFilters((f) => (f.q === q ? f : { ...f, q })), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    adminApi.listLocations({ status: filters.status, q: filters.q.trim() }).then((r) => { if (!cancelled) setState({ list: items(r).map(normLocation), loading: false, error: null }); })
      .catch((e) => { if (!cancelled && !onApiError(e)) setState((s) => ({ ...s, loading: false, error: e })); });
    return () => { cancelled = true; };
  }, [filters, rev, onApiError]);
  useEffect(() => { adminApi.listLocations({}).then((r) => setAll(items(r).map(normLocation))).catch(() => {}); }, [rev]);
  const mapOthers = useMemo(() => all, [all]);

  async function toggle(l) {
    setBusyId(l.id); setMsg({ kind: "", text: "" });
    try {
      await (l.status === "active" ? adminApi.deactivateLocation : adminApi.reactivateLocation)(l.id, l.versionNumber);
      setMsg({ kind: "ok", text: l.status === "active" ? `${l.name} deactivated. Routes using it are hidden from the public.` : `${l.name} reactivated.` }); setRev((n) => n + 1);
    } catch (e) { if (!onApiError(e)) { setMsg({ kind: "bad", text: errorMessage(e) }); if (isConflict(e)) setRev((n) => n + 1); } }
    finally { setBusyId(null); }
  }
  if (editing !== undefined) return <LocationForm location={editing} others={mapOthers} onCancel={() => setEditing(undefined)} onSaved={(m) => { setEditing(undefined); setMsg({ kind: "ok", text: m }); setRev((n) => n + 1); }} />;
  return (
    <div>
      <button className={styles.primary} onClick={() => setEditing(null)}>Register new location</button>
      <div className={styles.row} style={{ margin: "12px 0" }}>
        <select aria-label="Status filter" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <input type="search" aria-label="Search by name" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Status kind={msg.kind || undefined}>{msg.text}</Status>
      {state.loading && <Loading />}
      {state.error && <ErrorBlock error={state.error} onRetry={() => setRev((n) => n + 1)} />}
      {!state.loading && !state.error && state.list.length === 0 && <Empty>No locations match.</Empty>}
      {state.list.map((l) => (
        <div className={styles.card} key={l.id}>
          <strong>{l.name}</strong> <span className={styles.tag}>{l.status}</span> <span className={styles.muted}>v{l.versionNumber}</span>
          <div className={styles.muted}>{l.latitude.toFixed(6)}, {l.longitude.toFixed(6)}</div>
          <div className={styles.row} style={{ marginTop: 8 }}>
            <button onClick={() => setEditing(l)}>Edit</button>
            {l.status === "active"
              ? <ConfirmButton label="Deactivate" confirmLabel="Confirm deactivate" danger disabled={busyId === l.id} onConfirm={() => toggle(l)} />
              : <button disabled={busyId === l.id} onClick={() => toggle(l)}>Reactivate</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
