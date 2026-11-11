// All Admin / Super Admin API calls live here. They go through the shared api() from src/api.js (never fetch directly),
// which turns { error: { code, message, details } } into an ApiError with status, code, message and details.
//
// Everything in CONTRACT / the normalisers below is derived from the Team Guide and the README.
// If your docs/api-contracts.yaml differs, this is the ONLY file to adjust.
import { api } from "../../api";

export const CONTRACT = {
  // Prefix to add if your src/api.js does NOT already prepend "/api" (the guide lists paths as /api/...).
  pathPrefix: "",
  // How waypoints are SENT on create/update: "objects" -> [{ locationId, sequenceNumber }], "ids" -> [locationId].
  waypointsAs: "objects",
};

const call = (path, opts) => api(CONTRACT.pathPrefix + path, opts);
const qs = (params = {}) => {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") s.set(k, v); });
  const t = s.toString();
  return t ? `?${t}` : "";
};
const post = (path, body = {}) => call(path, { method: "POST", body });
const put = (path, body) => call(path, { method: "PUT", body });
const patch = (path, body) => call(path, { method: "PATCH", body });

// ---------- normalisers (tolerate small differences in response shape) ----------
export const items = (r) => (Array.isArray(r) ? r : r && Array.isArray(r.items) ? r.items : []);
export function normUser(r) {
  const u = (r && r.user) || r || {};
  return {
    id: u.id ?? u.userId, name: u.name, email: u.email, role: u.role,
    canRestore: u.canRestore, forcePasswordChange: !!(u.forcePasswordChange ?? u.mustChangePassword),
    accountStatus: u.accountStatus ?? u.status ?? "active",
  };
}
const bySeq = (a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0);
export function normRoute(r) {
  const wps = (r.waypoints || []).map((w) => (typeof w === "number" ? { locationId: w } : w)).slice().sort(bySeq);
  const pts = (r.points || []).slice().sort(bySeq);
  return {
    id: r.id ?? r.routeId, name: r.routeName ?? r.name ?? "Route",
    sourceId: r.sourceLocationId ?? r.sourceId, destinationId: r.destinationLocationId ?? r.destinationId,
    directionality: r.directionality ?? "one_way", hasStairs: r.hasStairs ?? null, hasRamp: r.hasRamp ?? null, isCovered: r.isCovered ?? null,
    notes: r.notes ?? "", status: r.status, versionNumber: r.versionNumber,
    pointCount: r.pointCount ?? (Array.isArray(r.points) ? r.points.length : null),
    points: pts, waypointIds: wps.map((w) => w.locationId ?? w.id),
  };
}
export const normLocation = (l) => ({ ...l, id: l.id ?? l.locationId, latitude: Number(l.latitude), longitude: Number(l.longitude), imageUrl: l.imageUrl ?? null, versionNumber: l.versionNumber });
const wpBody = (ids) => (CONTRACT.waypointsAs === "ids" ? ids : ids.map((locationId, i) => ({ locationId, sequenceNumber: i + 1 })));
// Builds the create / update body for a route from the editor state.
export function routeBody(f, { draft = true, waypointIds, points, expectedVersion } = {}) {
  const b = { routeName: f.name.trim(), directionality: f.directionality, hasStairs: f.hasStairs, hasRamp: f.hasRamp, isCovered: f.isCovered, notes: f.notes.trim() };
  if (draft) { b.sourceLocationId = Number(f.sourceId); b.destinationLocationId = Number(f.destinationId); }
  if (waypointIds) b.waypoints = wpBody(waypointIds);
  if (points) b.points = points.map(({ latitude, longitude, accuracy, recordedAt }) => ({ latitude, longitude, accuracy, recordedAt }));
  if (expectedVersion !== undefined) b.expectedVersion = expectedVersion;
  return b;
}

// ---------- endpoints ----------
export const adminApi = {
  // auth
  me: () => call("/auth/me"),
  login: (email, password) => post("/auth/login", { email, password }),
  logout: () => post("/auth/logout"),
  changePassword: ({ currentPassword, newPassword }) => post("/auth/change-password", { currentPassword, newPassword }),
  forgotPassword: (email) => post("/auth/forgot-password", { email }),
  resetPassword: ({ token, newPassword }) => post("/auth/reset-password", { token, newPassword }),
  // locations
  listLocations: (p) => call(`/admin/locations${qs(p)}`),
  getLocation: (id) => call(`/admin/locations/${id}`),
  createLocation: (body) => post("/admin/locations", body),
  updateLocation: (id, body) => put(`/admin/locations/${id}`, body),
  deactivateLocation: (id, expectedVersion) => post(`/admin/locations/${id}/deactivate`, { expectedVersion }),
  reactivateLocation: (id, expectedVersion) => post(`/admin/locations/${id}/reactivate`, { expectedVersion }),
  nearbyLocations: (lat, lng) => call(`/admin/locations/nearby${qs({ lat, lng })}`),
  uploadImage: (file) => { const fd = new FormData(); fd.append("image", file); return call("/admin/uploads/image", { method: "POST", body: fd }); },
  // routes
  listRoutes: (p) => call(`/admin/routes${qs(p)}`),
  getRoute: (id) => call(`/admin/routes/${id}`),
  createRoute: (body) => post("/admin/routes", body),
  addPoints: (id, points) => post(`/admin/routes/${id}/points`, { points }),
  updateRoute: (id, body) => put(`/admin/routes/${id}`, body),
  publishRoute: (id, expectedVersion) => post(`/admin/routes/${id}/publish`, { expectedVersion }),
  deactivateRoute: (id, expectedVersion) => post(`/admin/routes/${id}/deactivate`, { expectedVersion }),
  reactivateRoute: (id, expectedVersion) => post(`/admin/routes/${id}/reactivate`, { expectedVersion }),
  discardRoute: (id) => call(`/admin/routes/${id}`, { method: "DELETE" }),
  // history (reading the timeline/compare is Member 3's feature; restoring is ours)
  getEntity: (type, id) => (type === "route" ? adminApi.getRoute(id) : adminApi.getLocation(id)),
  restore: (type, id, { versionNumber, expectedVersion }) => post(`/admin/${type === "route" ? "routes" : "locations"}/${id}/restore`, { versionNumber, expectedVersion }),
  // super admin
  listUsers: () => call("/admin/users"),
  createUser: (body) => post("/admin/users", body),
  updateUser: (id, body) => patch(`/admin/users/${id}`, body),
  auditLogs: (p) => call(`/admin/audit-logs${qs(p)}`),
};
