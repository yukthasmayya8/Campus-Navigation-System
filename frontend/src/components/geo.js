export function distanceMeters(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLa = (b.latitude - a.latitude) * rad, dLn = (b.longitude - a.longitude) * rad;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export const pathLength = (pts) => pts.reduce((s, p, i) => (i ? s + distanceMeters(pts[i - 1], p) : 0), 0);
export const MAX_ACCURACY_M = 25; // keep only fixes this accurate or better
export const MIN_SPACING_M = 3; // and at least this far from the previous kept point
export function acceptFix(fix, last) {
  if (fix.accuracy > MAX_ACCURACY_M) return { ok: false, reason: "weak" };
  if (last && distanceMeters(last, fix) < MIN_SPACING_M) return { ok: false, reason: "close" };
  return { ok: true };
}
export function capturePosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("Location is not available on this device."));
    navigator.geolocation.getCurrentPosition((g) => res(g.coords), (e) => rej(new Error(e.code === 1 ? "Location permission was denied. Allow location access in the browser and try again." : "GPS signal is unavailable. Move to open sky and try again.")), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
}
