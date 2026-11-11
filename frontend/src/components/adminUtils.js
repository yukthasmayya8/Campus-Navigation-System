export const PASSWORD_RULE_TEXT = "At least 10 characters with upper case, lower case and a digit.";
export const isSecure = () => typeof window !== "undefined" && (window.isSecureContext || window.location.hostname === "localhost");

export function passwordProblems(pw) {
  const out = [];
  if (!pw || pw.length < 10) out.push("at least 10 characters");
  if (!/[A-Z]/.test(pw || "")) out.push("an upper-case letter");
  if (!/[a-z]/.test(pw || "")) out.push("a lower-case letter");
  if (!/\d/.test(pw || "")) out.push("a digit");
  return out;
}
// Collect human-readable strings from ApiError.details (the server's own validation messages).
export function detailLines(details) {
  const out = [];
  const walk = (v) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") ["errors", "requirements", "messages", "problems"].forEach((k) => k in v && walk(v[k]));
  };
  walk(details);
  return out;
}
export function errorMessage(err) {
  if (!err) return "";
  if (err.code === "NETWORK" || err.status === 0) return "Cannot reach the server. Check your connection and try again.";
  if (err.status === 403 && err.code !== "PASSWORD_CHANGE_REQUIRED") return "You do not have permission for this action.";
  if (err.code === "VERSION_CONFLICT") return "Someone else changed this record. Reload to see the latest version.";
  const lines = detailLines(err.details).filter((l) => !(err.message || "").includes(l));
  return [err.message || "Something went wrong.", ...lines].join(" ");
}
export const isConflict = (e) => e && e.code === "VERSION_CONFLICT";
export const fmtDate = (t) => { try { return new Date(t).toLocaleString(); } catch { return String(t ?? ""); } };
export const triText = (v) => (v === null || v === undefined ? "Not verified" : v ? "Yes" : "No");
export const fmtMeters = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
export const debounceValue = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };
