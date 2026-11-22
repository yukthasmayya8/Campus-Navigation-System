import { useCallback, useEffect, useRef, useState } from 'react';
import { GAP_AFTER_MS, MAX_ACCURACY_M, MAX_SPEED_MPS, MIN_SPACING_M, haversine, isSecureContextOk } from '../lib/geo.js';

const STORAGE_KEY = 'campus-nav-recording-v1';

function readSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeSession(data) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* quota / privacy mode */ }
}

function clearSession() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/**
 * Real GPS route recorder. It never generates points: a point exists only after the
 * browser Geolocation API produced an accepted fix.
 *
 * The session (points, gaps, elapsed time) is mirrored to sessionStorage so ordinary
 * component remounts or a page refresh cannot lose recorded coordinates. A reload always
 * restores into a PAUSED state - recording never resumes silently.
 */
export function useGpsRecorder({ onPoint } = {}) {
  const restored = useRef(readSession());
  const [points, setPoints] = useState(() => (Array.isArray(restored.current?.points) ? restored.current.points : []));
  const [gaps, setGaps] = useState(() => (Array.isArray(restored.current?.gaps) ? restored.current.gaps : []));
  const [status, setStatus] = useState(() => (restored.current?.points?.length ? 'paused' : 'idle'));
  const [message, setMessage] = useState(() =>
    restored.current?.points?.length ? 'Recording was paused when this page reloaded. Tap Resume to continue from here.' : '');
  const [accuracy, setAccuracy] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(() => Number(restored.current?.elapsedMs) || 0);
  const [lastFixAt, setLastFixAt] = useState(null);

  const pointsRef = useRef(points);
  const gapsRef = useRef(gaps);
  const seqRef = useRef(Number(restored.current?.seq) || 0);
  const lastRef = useRef(null);
  const watchRef = useRef(null);
  const timerRef = useRef(null);
  const startedAtRef = useRef(null);
  const accumulatedRef = useRef(Number(restored.current?.elapsedMs) || 0);
  const pauseAtRef = useRef(null);
  const restoredAtRef = useRef(Number.isFinite(Date.parse(restored.current?.savedAt)) ? Date.parse(restored.current.savedAt) : null);
  const interruptionAtRef = useRef(null);
  const statusRef = useRef(status);
  const onPointRef = useRef(onPoint);
  onPointRef.current = onPoint;

  pointsRef.current = points;
  gapsRef.current = gaps;
  statusRef.current = status;

  const persist = useCallback((nextPoints = pointsRef.current, nextGaps = gapsRef.current, wasActive = statusRef.current === 'recording' || statusRef.current === 'paused') => {
    writeSession({ points: nextPoints, gaps: nextGaps, seq: seqRef.current, elapsedMs: accumulatedRef.current + (startedAtRef.current ? Date.now() - startedAtRef.current : 0), wasActive, savedAt: new Date().toISOString() });
  }, []);

  const stopWatch = useCallback(() => {
    if (watchRef.current !== null) {
      try { navigator.geolocation.clearWatch(watchRef.current); } catch { /* ignore */ }
      watchRef.current = null;
    }
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    timerRef.current = setInterval(() => setElapsedMs(accumulatedRef.current + (startedAtRef.current ? Date.now() - startedAtRef.current : 0)), 1000);
  }, [stopTimer]);

  const markGap = useCallback(() => {
    if (!pointsRef.current.length) return;
    const index = pointsRef.current.length - 1;
    if (gapsRef.current.includes(index)) return;
    const next = [...gapsRef.current, index];
    setGaps(next);
    gapsRef.current = next;
    persist(pointsRef.current, next, true);
    setMessage('GPS signal was interrupted. The points before and after the gap are kept separate; a warning will be shown before publishing.');
  }, [persist]);

  const watchPosition = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus('unavailable');
      setMessage('This browser does not support GPS. Use a device with location support.');
      return;
    }
    if (!isSecureContextOk()) {
      setStatus('unavailable');
      setMessage('GPS requires HTTPS (or localhost). Open this site over https:// to record a route.');
      return;
    }
    stopWatch();
    lastRef.current = null;
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const now = Number.isFinite(pos.timestamp) ? pos.timestamp : Date.now();
        const acc = Number.isFinite(c.accuracy) ? c.accuracy : null;
        setAccuracy(acc);
        setLastFixAt(now);
        if (![c.latitude, c.longitude].every(Number.isFinite)) {
          setMessage('Ignoring an invalid GPS fix.');
          return;
        }
        if (acc == null || acc > MAX_ACCURACY_M) {
          setMessage(`GPS accuracy is weak (±${acc == null ? '?' : Math.round(acc)} m). Waiting for ${MAX_ACCURACY_M} m or better - no points are saved yet.`);
          return;
        }

        // A new fix after an interruption: mark a gap instead of drawing a straight line silently.
        if (interruptionAtRef.current != null) {
          const gapMs = Date.now() - interruptionAtRef.current;
          interruptionAtRef.current = null;
          if (gapMs > GAP_AFTER_MS) markGap();
        }

        if (lastRef.current) {
          const dt = Math.max((now - lastRef.current.time) / 1000, 0.001);
          const dist = haversine(lastRef.current, { latitude: c.latitude, longitude: c.longitude });
          if (dist / dt > MAX_SPEED_MPS) {
            setMessage('Ignored an unreliable GPS jump. Keep walking; the next valid fix will be recorded.');
            return;
          }
          if (dist < MIN_SPACING_M) return;
        }

        const point = {
          sequenceNumber: ++seqRef.current,
          latitude: c.latitude,
          longitude: c.longitude,
          accuracy: Math.round((acc || 0) * 10) / 10,
          recordedAt: new Date(now).toISOString(),
        };
        lastRef.current = { ...point, time: now };
        const nextPoints = [...pointsRef.current, point];
        pointsRef.current = nextPoints;
        setPoints(nextPoints);
        persist(nextPoints, gapsRef.current, true);
        setMessage('');
        onPointRef.current?.(point);
      },
      (err) => {
        const at = Date.now();
        if (err.code === 1) {
          stopWatch(); stopTimer();
          setStatus('denied');
          setMessage('Location permission was denied. Allow location access in the browser, then tap Resume.');
          persist(pointsRef.current, gapsRef.current, true);
          return;
        }
        // A temporary loss must not end the recording. Keep the existing points and wait.
        if (interruptionAtRef.current == null) interruptionAtRef.current = at;
        setMessage(err.code === 2
          ? 'GPS signal lost. Points already recorded are safe; waiting for the signal to return.'
          : 'GPS request timed out. Still waiting for the next fix; recorded points are safe.');
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }, [markGap, persist, stopTimer, stopWatch]);

  const begin = useCallback(({ keepPoints = false } = {}) => {
    if (!keepPoints) {
      pointsRef.current = []; gapsRef.current = []; seqRef.current = 0; accumulatedRef.current = 0;
      setPoints([]); setGaps([]); setElapsedMs(0); setLastFixAt(null); setAccuracy(null);
    }
    startedAtRef.current = Date.now();
    pauseAtRef.current = null;
    interruptionAtRef.current = null;
    statusRef.current = 'recording';
    setStatus('recording');
    setMessage('Waiting for your first GPS fix…');
    startTimer();
    watchPosition();
    persist(keepPoints ? pointsRef.current : [], keepPoints ? gapsRef.current : [], true);
  }, [persist, startTimer, watchPosition]);

  const pause = useCallback(() => {
    if (statusRef.current !== 'recording') return;
    stopWatch(); stopTimer();
    if (startedAtRef.current) { accumulatedRef.current += Date.now() - startedAtRef.current; startedAtRef.current = null; }
    setElapsedMs(accumulatedRef.current);
    pauseAtRef.current = Date.now();
    statusRef.current = 'paused';
    setStatus('paused');
    setMessage('Recording paused. Tap Resume before you start walking again.');
    persist(pointsRef.current, gapsRef.current, true);
  }, [persist, stopTimer, stopWatch]);

  const resume = useCallback(() => {
    if (statusRef.current === 'recording') return;
    // A long pause (or a reload) must not be drawn as a continuous walk.
    const pausedAt = pauseAtRef.current ?? restoredAtRef.current;
    const pausedFor = pausedAt ? Date.now() - pausedAt : 0;
    if (pausedFor > GAP_AFTER_MS && pointsRef.current.length) markGap();
    startedAtRef.current = Date.now();
    pauseAtRef.current = null;
    restoredAtRef.current = null;
    interruptionAtRef.current = Date.now();
    statusRef.current = 'recording';
    setStatus('recording');
    setAccuracy(null);
    setMessage(pausedFor > GAP_AFTER_MS
      ? 'Resuming after a break. The break is marked as a gap; the next fix continues a new segment.'
      : 'Resuming recording. Waiting for the next GPS fix…');
    startTimer();
    watchPosition();
    persist(pointsRef.current, gapsRef.current, true);
  }, [markGap, persist, startTimer, watchPosition]);

  const stop = useCallback(() => {
    stopWatch(); stopTimer();
    if (startedAtRef.current) { accumulatedRef.current += Date.now() - startedAtRef.current; startedAtRef.current = null; }
    setElapsedMs(accumulatedRef.current);
    statusRef.current = 'stopped';
    setStatus('stopped');
    setMessage('Recording stopped. Review the path before saving.');
    persist(pointsRef.current, gapsRef.current, false);
  }, [persist, stopTimer, stopWatch]);

  const reset = useCallback(() => {
    stopWatch(); stopTimer();
    pointsRef.current = []; gapsRef.current = []; seqRef.current = 0; lastRef.current = null;
    accumulatedRef.current = 0; startedAtRef.current = null; pauseAtRef.current = null; interruptionAtRef.current = null;
    setPoints([]); setGaps([]); setElapsedMs(0); setAccuracy(null); setLastFixAt(null);
    statusRef.current = 'idle'; setStatus('idle'); setMessage('');
    clearSession();
  }, [stopTimer, stopWatch]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && statusRef.current === 'recording') {
        setMessage('Back in the app. Check that the point count is still increasing; mobile browsers may pause GPS while the screen is locked.');
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      persist(pointsRef.current, gapsRef.current, statusRef.current === 'recording' || statusRef.current === 'paused');
      stopWatch(); stopTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = status === 'recording' || status === 'paused';
  return {
    points, gaps, status, message, accuracy, elapsedMs, lastFixAt, active,
    start: begin, pause, resume, stop, reset,
    hasSession: points.length > 0,
    clearSession,
  };
}
