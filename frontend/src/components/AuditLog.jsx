import { useEffect, useState } from "react";
import { adminApi } from "./adminApi";
import { useAdminAuth } from "./AuthContext";
import { usePagedList } from "./usePagedList";
import { fmtDate } from "./adminUtils";
import { Loading, ErrorBlock, Empty, LoadMore, styles } from "./ui";

const summarize = (o) => (o && Array.isArray(o.points) ? { ...o, points: `${o.points.length} points` } : o);
// Super Admin only: who changed what and when, filterable and paginated.
export default function AuditLog() {
  const { isSuperAdmin, onApiError } = useAdminAuth();
  const [type, setType] = useState(""), [entityId, setEntityId] = useState("");
  const list = usePagedList((p) => adminApi.auditLogs({ entityType: type, entityId: entityId.trim(), ...p }), [type, entityId], 20);
  useEffect(() => { if (list.error) onApiError(list.error); }, [list.error, onApiError]);
  if (!isSuperAdmin) return <div className={styles.card} role="alert"><strong>You do not have permission to view this page.</strong></div>;
  return (
    <div>
      <div className={styles.row}>
        <select aria-label="Entity type" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option><option value="location">Locations</option><option value="route">Routes</option><option value="user">Accounts</option></select>
        <input aria-label="Entity ID" inputMode="numeric" placeholder="Entity ID" value={entityId} onChange={(e) => setEntityId(e.target.value.replace(/\D/g, ""))} />
      </div>
      <div style={{ marginTop: 10 }} />
      {list.loading && list.items.length === 0 && <Loading />}
      {list.error && list.error.status !== 401 && <ErrorBlock error={list.error} onRetry={list.reload} />}
      {!list.loading && !list.error && list.items.length === 0 && <Empty>No audit entries.</Empty>}
      {list.items.map((a, i) => (
        <div className={styles.card} key={a.id ?? i}>
          <strong>{a.action}</strong>
          <div className={styles.muted}>{a.entityType} #{a.entityId ?? "-"} · {a.administratorName ?? a.adminName ?? a.administratorEmail ?? "system"} · {fmtDate(a.timestamp ?? a.createdAt)}</div>
          {(a.previousData || a.newData) && <details><summary className={styles.muted}>Details</summary><pre className={styles.pre}>{JSON.stringify({ before: summarize(a.previousData), after: summarize(a.newData) }, null, 2)}</pre></details>}
        </div>
      ))}
      <LoadMore shown={list.items.length} total={list.total} loading={list.loading} onMore={list.loadMore} />
    </div>
  );
}
