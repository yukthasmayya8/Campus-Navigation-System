import { useEffect, useState } from "react";
import { adminApi, items, normLocation, normRoute } from "./adminApi";
import { useAdminAuth } from "./AuthContext";
import { usePagedList } from "./usePagedList";
import { errorMessage, isConflict } from "./adminUtils";
import { Loading, ErrorBlock, Empty, Status, ConfirmButton, LoadMore, TriTag, styles } from "./ui";
import RouteRecorder from "./RouteRecorder";

// List / filter / paginate routes and run status actions. Draft routes are never visible to the public.
export default function RouteManagement() {
  const { onApiError } = useAdminAuth();
  const [locations, setLocations] = useState([]), [locError, setLocError] = useState(null);
  const [filters, setFilters] = useState({ status: "", sourceLocationId: "", destinationLocationId: "" });
  const [open, setOpen] = useState(undefined); // undefined = list, null = new, route = editor
  const [msg, setMsg] = useState({ kind: "", text: "" }), [busyId, setBusyId] = useState(null);

  useEffect(() => { adminApi.listLocations({}).then((r) => setLocations(items(r).map(normLocation))).catch((e) => { if (!onApiError(e)) setLocError(e); }); }, [onApiError]);
  const list = usePagedList((p) => adminApi.listRoutes({ ...filters, ...p }), [filters.status, filters.sourceLocationId, filters.destinationLocationId], 10);
  useEffect(() => { if (list.error) onApiError(list.error); }, [list.error, onApiError]);
  const nameOf = (id) => (locations.find((l) => l.id === Number(id)) || {}).name || `#${id}`;

  async function edit(id) {
    setMsg({ kind: "", text: "" });
    try { setOpen(normRoute(await adminApi.getRoute(id))); } catch (e) { if (!onApiError(e)) setMsg({ kind: "bad", text: errorMessage(e) }); }
  }
  async function act(r, kind) {
    setBusyId(r.id); setMsg({ kind: "", text: "" });
    try {
      if (kind === "publish") await adminApi.publishRoute(r.id, r.versionNumber);
      else if (kind === "deactivate") await adminApi.deactivateRoute(r.id, r.versionNumber);
      else if (kind === "reactivate") await adminApi.reactivateRoute(r.id, r.versionNumber);
      else if (kind === "discard") await adminApi.discardRoute(r.id);
      setMsg({ kind: "ok", text: { publish: "Route published.", deactivate: "Route deactivated.", reactivate: "Route reactivated.", discard: "Draft discarded." }[kind] });
      list.reload();
    } catch (e) { if (!onApiError(e)) { setMsg({ kind: "bad", text: errorMessage(e) }); if (isConflict(e)) list.reload(); } }
    finally { setBusyId(null); }
  }
  if (open !== undefined) return <RouteRecorder key={open ? open.id : "new"} route={open} locations={locations} onClose={(m) => { setOpen(undefined); if (m) setMsg({ kind: "ok", text: m }); list.reload(); }} />;
  const opts = <>{<option value="">Any</option>}{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</>;
  return (
    <div>
      <button className={styles.primary} onClick={() => setOpen(null)} disabled={!!locError}>Record new route</button>
      <div className={styles.row} style={{ margin: "12px 0" }}>
        <select aria-label="Status filter" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">All statuses</option><option value="draft">Draft</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <select aria-label="Source filter" value={filters.sourceLocationId} onChange={(e) => setFilters({ ...filters, sourceLocationId: e.target.value })}>{opts}</select>
        <select aria-label="Destination filter" value={filters.destinationLocationId} onChange={(e) => setFilters({ ...filters, destinationLocationId: e.target.value })}>{opts}</select>
      </div>
      <Status kind={msg.kind || undefined}>{msg.text}</Status>
      {locError && <ErrorBlock error={locError} />}
      {list.loading && list.items.length === 0 && <Loading />}
      {list.error && list.error.status !== 401 && <ErrorBlock error={list.error} onRetry={list.reload} />}
      {!list.loading && !list.error && list.items.length === 0 && <Empty>No routes match.</Empty>}
      {list.items.map((raw) => {
        const r = normRoute(raw);
        return (
          <div className={styles.card} key={r.id}>
            <strong>{r.name}</strong> <span className={styles.tag}>{r.status}</span> <span className={styles.muted}>v{r.versionNumber}</span>
            <div className={styles.muted}>{raw.sourceName || nameOf(r.sourceId)} → {raw.destinationName || nameOf(r.destinationId)} · {r.directionality === "one_way" ? "one way" : "bidirectional"}{r.pointCount != null ? ` · ${r.pointCount} points` : ""}</div>
            <div className={styles.tags}><TriTag label="Stairs" value={r.hasStairs} /><TriTag label="Ramp" value={r.hasRamp} /><TriTag label="Covered" value={r.isCovered} /></div>
            <div className={styles.row}>
              <button onClick={() => edit(r.id)}>Edit</button>
              {r.status === "draft" && <><button disabled={busyId === r.id} onClick={() => act(r, "publish")}>Publish</button><ConfirmButton label="Discard draft" confirmLabel="Confirm discard" danger onConfirm={() => act(r, "discard")} /></>}
              {r.status === "active" && <ConfirmButton label="Deactivate" confirmLabel="Confirm deactivate" danger disabled={busyId === r.id} onConfirm={() => act(r, "deactivate")} />}
              {r.status === "inactive" && <button disabled={busyId === r.id} onClick={() => act(r, "reactivate")}>Reactivate</button>}
            </div>
          </div>
        );
      })}
      <LoadMore shown={list.items.length} total={list.total} loading={list.loading} onMore={list.loadMore} />
    </div>
  );
}
