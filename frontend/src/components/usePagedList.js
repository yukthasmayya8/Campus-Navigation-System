import { useCallback, useEffect, useRef, useState } from "react";
import { items as pick } from "./adminApi";

// Paginated list with loading / empty / error states. Only the newest request may update the state,
// so a slow older response can never overwrite a fresher one.
export function usePagedList(fetchPage, deps, limit = 10) {
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: null });
  const seq = useRef(0), fetchRef = useRef(fetchPage), countRef = useRef(0);
  fetchRef.current = fetchPage;
  const load = useCallback(async (reset) => {
    const my = ++seq.current;
    const offset = reset ? 0 : countRef.current;
    setState((s) => ({ ...s, loading: true, error: null, items: reset ? [] : s.items }));
    try {
      const r = await fetchRef.current({ limit, offset });
      if (my !== seq.current) return;
      const list = pick(r);
      setState((s) => {
        const all = reset ? list : [...s.items, ...list];
        countRef.current = all.length;
        return { items: all, total: typeof r.total === "number" ? r.total : all.length, loading: false, error: null };
      });
    } catch (e) {
      if (my !== seq.current) return;
      setState((s) => ({ ...s, loading: false, error: e }));
    }
  }, [limit]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { countRef.current = 0; load(true); }, [load, ...deps]);
  return { ...state, reload: () => load(true), loadMore: () => load(false) };
}
