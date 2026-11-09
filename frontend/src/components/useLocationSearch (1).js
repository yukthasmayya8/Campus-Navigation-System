import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSuggestions, searchCached } from './searchApi.js';
import { dedupe, prefixFirst } from './searchUtils.js';

export const DEBOUNCE_MS = 300;

const IDLE = { status: 'idle', items: [], message: '' };

/**
 * status: 'idle' | 'loading' | 'success' | 'offline' | 'error'
 *  - offline = request failed with NETWORK and we are showing cached results
 */
export function useLocationSearch(query, enabled = true) {
  const [state, setState] = useState(IDLE);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const mySeq = ++seq.current; // every run invalidates all earlier runs

    if (!enabled || !q) {
      setState(IDLE);
      return undefined;
    }

    // Drop old suggestions immediately so results for an older query never show.
    setState({ status: 'loading', items: [], message: '' });

    const controller = new AbortController();
    const isStale = () => mySeq !== seq.current;

    const timer = setTimeout(async () => {
      try {
        const raw = await fetchSuggestions(q, { signal: controller.signal });
        if (isStale()) return;
        setState({ status: 'success', items: dedupe(prefixFirst(raw, q)), message: '' });
      } catch (err) {
        if (err?.name === 'AbortError' || isStale()) return;

        if (err?.code === 'NETWORK') {
          try {
            const cached = await searchCached(q);
            if (isStale()) return;
            setState({
              status: 'offline',
              items: dedupe(cached),
              message: "Can't reach the server. Showing saved locations.",
            });
            return;
          } catch {
            /* no offline cache available, fall through to the error state */
          }
        }
        if (isStale()) return;
        setState({
          status: 'error',
          items: [],
          message:
            err?.code === 'NETWORK'
              ? "Can't reach the server and no saved locations are available."
              : 'Search failed. Try again.',
        });
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, enabled, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, retry };
}
