import { useCallback, useEffect, useRef, useState } from "react";
import { acceptFix, MAX_ACCURACY_M } from "./geo";
import { isSecure } from "./adminUtils";

// Watches GPS and emits only good points: accuracy <= 25 m and >= 3 m from the previous kept point.
// Every point carries its own sequenceNumber so a retried upload batch can never create duplicates.
export function useGpsRecorder({ onPoint }) {
  const [state, setState] = useState({ status: "idle", message: "", accuracy: null });
  const watchRef = useRef(null), seqRef = useRef(0), lastRef = useRef(null), cbRef = useRef(onPoint);
  cbRef.current = onPoint;

  const clear = () => { if (watchRef.current !== null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; } };
  const stop = useCallback(() => { clear(); setState((s) => ({ status: "idle", message: s.status === "idle" ? "" : "Recording stopped.", accuracy: s.accuracy })); }, []);
  const start = useCallback(({ seq = 0, last = null } = {}) => {
    if (!navigator.geolocation) return setState({ status: "unavailable", message: "GPS is not available on this device.", accuracy: null });
    if (!isSecure()) return setState({ status: "unavailable", message: "GPS needs HTTPS. Open this site over https:// to record.", accuracy: null });
    clear(); seqRef.current = seq; lastRef.current = last;
    setState({ status: "waiting", message: "Waiting for a GPS fix…", accuracy: null });
    watchRef.current = navigator.geolocation.watchPosition((pos) => {
      const c = pos.coords, fix = { latitude: c.latitude, longitude: c.longitude, accuracy: Math.round(c.accuracy * 10) / 10, recordedAt: new Date(pos.timestamp || Date.now()).toISOString() };
      const r = acceptFix(fix, lastRef.current);
      if (!r.ok) {
        if (r.reason === "weak") setState({ status: "waiting", message: `Weak GPS signal (±${Math.round(c.accuracy)} m). No points are saved until accuracy is ${MAX_ACCURACY_M} m or better.`, accuracy: c.accuracy });
        return;
      }
      const point = { ...fix, sequenceNumber: ++seqRef.current };
      lastRef.current = point;
      cbRef.current(point);
      setState({ status: "recording", message: `Recording (±${Math.round(c.accuracy)} m)…`, accuracy: c.accuracy });
    }, (e) => {
      clear();
      setState(e.code === 1
        ? { status: "denied", message: "Location permission was denied. Allow location access in the browser and try again.", accuracy: null }
        : { status: "unavailable", message: "GPS signal is unavailable. Move to open sky and try again.", accuracy: null });
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  }, []);
  useEffect(() => clear, []);
  return { ...state, active: state.status === "waiting" || state.status === "recording", start, stop };
}
