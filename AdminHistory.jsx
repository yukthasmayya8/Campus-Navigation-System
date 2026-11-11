import { useEffect, useId, useState } from "react";
import { adminApi, items, normRoute } from "../adminApi";
import { useAdminAuth } from "../AuthContext";
import { Loading, ErrorBlock, Empty, Field, styles } from "../ui";
import RestoreSnapshot from "./RestoreSnapshot";
// Member 3's components (merged before admin). Contract from the guide:
//   VersionHistory({ entityType, entityId, canRestore, onRestore(versionNumber) })   VersionComparison({ entityType, entityId })
import { VersionHistory, VersionComparison } from "../../history";

// Picks a location or route, shows Member 3's timeline + comparison, and supplies the Restore action (Super Admin only).
export default function AdminHistory() {
  const { canRestore, onApiError } = useAdminAuth(), tid = useId(), eid = useId();
  const [type, setType] = useState("location"), [list, setList] = useState({ items: [], loading: true, error: null }), [id, setId] = useState(null);
  const [pending, setPending] = useState(null), [bump, setBump] = useState(0), [rev, setRev] = useState(0);

  useEffect(() => {
    let off = false; setList({ items: [], loading: true, error: null }); setId(null); setPending(null);
    (type === "location" ? adminApi.listLocations({}) : adminApi.listRoutes({ limit: 100 }))
      .then((r) => { if (off) return; const rows = items(r).map((x) => (type === "route" ? { id: normRoute(x).id, label: `${normRoute(x).name} (${x.sourceName || normRoute(x).sourceId} → ${x.destinationName || normRoute(x).destinationId})` } : { id: x.id, label: x.name })); setList({ items: rows, loading: false, error: null }); setId(rows[0] ? rows[0].id : null); })
      .catch((e) => { if (!off && !onApiError(e)) setList({ items: [], loading: false, error: e }); });
    return () => { off = true; };
  }, [type, rev, onApiError]);

  return (
    <div>
      <div className={styles.row}>
        <Field label="Type" htmlFor={tid}><select id={tid} value={type} onChange={(e) => setType(e.target.value)}><option value="location">Locations</option><option value="route">Routes</option></select></Field>
        <Field label={type === "location" ? "Location" : "Route"} htmlFor={eid}>
          <select id={eid} value={id ?? ""} disabled={!list.items.length} onChange={(e) => { setId(Number(e.target.value)); setPending(null); }}>{list.items.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        </Field>
      </div>
      {list.loading && <Loading />}
      {list.error && <ErrorBlock error={list.error} onRetry={() => setRev((n) => n + 1)} />}
      {!list.loading && !list.error && !list.items.length && <Empty>Nothing to show yet.</Empty>}
      {id != null && (<>
        {pending != null && canRestore && <RestoreSnapshot entityType={type} entityId={id} versionNumber={pending} onCancel={() => setPending(null)} onRestored={() => setBump((n) => n + 1)} />}
        <VersionComparison key={`c-${type}-${id}-${bump}`} entityType={type} entityId={id} />
        <VersionHistory key={`h-${type}-${id}-${bump}`} entityType={type} entityId={id} canRestore={canRestore} onRestore={(v) => setPending(v)} />
      </>)}
    </div>
  );
}
