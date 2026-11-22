import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Screen Wake Lock wrapper.
 *
 * Phones may drop the lock when the tab is hidden or the screen turns off. This hook
 * re-requests it when the page becomes visible again and reports the real state so the
 * UI can tell the user what the browser is actually doing (never a fake "on" badge).
 */
export function useWakeLock(active) {
  const lockRef = useRef(null);
  const activeRef = useRef(Boolean(active));
  const [state, setState] = useState(() =>
    typeof navigator !== 'undefined' && 'wakeLock' in navigator ? 'idle' : 'unsupported');
  activeRef.current = Boolean(active);

  const release = useCallback(async () => {
    const lock = lockRef.current;
    lockRef.current = null;
    try { await lock?.release?.(); } catch { /* browser already released it */ }
    setState((s) => (s === 'unsupported' ? s : 'off'));
  }, []);

  const acquire = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      setState('unsupported');
      return null;
    }
    // Requesting while hidden throws on some browsers; the visibility listener retries.
    if (!activeRef.current || document.visibilityState !== 'visible') return null;
    if (lockRef.current && !lockRef.current.released) return lockRef.current;
    try {
      const lock = await navigator.wakeLock.request('screen');
      lockRef.current = lock;
      setState('on');
      lock.addEventListener?.('release', () => {
        if (lockRef.current === lock) lockRef.current = null;
        setState(activeRef.current ? 'released' : 'off');
      });
      return lock;
    } catch {
      setState('error');
      return null;
    }
  }, []);

  useEffect(() => {
    if (active) acquire();
    else release();
    return () => { release(); };
  }, [active, acquire, release]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && activeRef.current) acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [acquire]);

  return { state, supported: state !== 'unsupported', acquire, release };
}
