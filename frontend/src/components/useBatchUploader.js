import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi } from "./adminApi";

// Uploads recorded points to a draft route in batches (every 5 points or 5 s). Failed batches stay in the queue and are
// retried automatically (timer, or when the browser comes back online). Sequence numbers make retries idempotent.
export function useBatchUploader({ routeId, enabled, initialSaved = 0 }) {
  const queue = useRef([]), flushing = useRef(false);
  const [stats, setStats] = useState({ saved: initialSaved, pending: 0, error: null });
  const sync = () => setStats((s) => ({ ...s, pending: queue.current.length }));

  const flush = useCallback(async () => {
    if (!enabled || !routeId) return true;
    if (flushing.current) return false;
    while (queue.current.length) {
      flushing.current = true;
      const batch = queue.current.splice(0, 200);
      try {
        const r = await adminApi.addPoints(routeId, batch);
        setStats((s) => ({ ...s, saved: typeof (r && r.pointCount) === "number" ? r.pointCount : s.saved + batch.length, error: null }));
      } catch (e) {
        queue.current.unshift(...batch); flushing.current = false;
        setStats((s) => ({ ...s, error: e, pending: queue.current.length }));
        return false;
      }
      flushing.current = false; sync();
    }
    return true;
  }, [routeId, enabled]);

  const enqueue = useCallback((p) => { queue.current.push(p); sync(); if (queue.current.length >= 5) flush(); }, [flush]);
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setInterval(flush, 5000), online = () => flush();
    const guard = (e) => { if (queue.current.length) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("online", online); window.addEventListener("beforeunload", guard);
    return () => { clearInterval(t); window.removeEventListener("online", online); window.removeEventListener("beforeunload", guard); };
  }, [enabled, flush]);
  return { ...stats, enqueue, flush, hasPending: () => queue.current.length > 0 };
}
