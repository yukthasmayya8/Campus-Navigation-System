import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../adminApi";
import { useAdminAuth } from "../AuthContext";
import { errorMessage, isConflict } from "../adminUtils";
import { Loading, Status, styles } from "../ui";

// Supplies the action behind Member 3's Restore button. Rendered only when canRestore is true.
//  1. confirmation  2. expectedVersion check (409 -> conflict state with Reload)  3. clear result: the resulting status.
export default function RestoreSnapshot({ entityType, entityId, versionNumber, onCancel, onRestored }) {
  const { onApiError, canRestore } = useAdminAuth();
  const [phase, setPhase] = useState("loading"); // loading | confirm | working | done | conflict | error
  const [current, setCurrent] = useState(null), [result, setResult] = useState(null), [error, setError] = useState(null);

  const loadCurrent = useCallback(async () => {
    setPhase("loading"); setError(null);
    try { const e = await adminApi.getEntity(entityType, entityId); setCurrent({ version: e.versionNumber, name: e.name || e.routeName || `#${entityId}` }); setPhase("confirm"); }
    catch (err) { if (!onApiError(err)) { setError(err); setPhase("error"); } }
  }, [entityType, entityId, onApiError]);
  useEffect(() => { loadCurrent(); }, [loadCurrent, versionNumber]);
  if (!canRestore) return null;

  async function restore() {
    setPhase("working");
    try {
      await adminApi.restore(entityType, entityId, { versionNumber, expectedVersion: current.version });
      // Read the result back so the status shown is the real, stored one.
      const after = await adminApi.getEntity(entityType, entityId);
      let hidden = false;
      if (entityType === "route" && after.status === "active") {
        const ends = await Promise.all([after.sourceLocationId, after.destinationLocationId].map((id) => adminApi.getLocation(id).catch(() => null)));
        hidden = ends.some((l) => l && l.status !== "active");
      }
      setResult({ status: after.status, version: after.versionNumber, hidden }); setPhase("done"); onRestored && onRestored();
    } catch (err) {
      if (onApiError(err)) return;
      setError(err); setPhase(isConflict(err) ? "conflict" : "error");
    }
  }
  return (
    <div className={styles.card} role="region" aria-label="Restore version">
      {phase === "loading" && <Loading />}
      {phase === "confirm" && (<>
        <strong>Restore version {versionNumber} of {current.name}?</strong>
        <p className={styles.muted}>This creates a new version and keeps all history. The record can come back inactive, and a route whose location is inactive stays hidden from the public.</p>
        <div className={styles.row}><button className={styles.primary} onClick={restore}>Confirm restore</button><button onClick={onCancel}>Cancel</button></div>
      </>)}
      {phase === "working" && <Loading label="Restoring…" />}
      {phase === "done" && (<>
        <Status kind="ok">{`Restored version ${versionNumber} as version ${result.version}. Status is now ${result.status}.`}</Status>
        {result.status === "inactive" && <p className={styles.muted}>This {entityType} is inactive and not visible to the public.</p>}
        {result.hidden && <p className={styles.muted}>The route stays hidden from the public while one of its locations is inactive.</p>}
        <button onClick={onCancel}>Close</button>
      </>)}
      {phase === "conflict" && (<><Status kind="bad">{errorMessage(error)}</Status><div className={styles.row}><button onClick={loadCurrent}>Reload</button><button onClick={onCancel}>Cancel</button></div></>)}
      {phase === "error" && (<><Status kind="bad">{errorMessage(error)}</Status><div className={styles.row}><button onClick={loadCurrent}>Retry</button><button onClick={onCancel}>Cancel</button></div></>)}
    </div>
  );
}
