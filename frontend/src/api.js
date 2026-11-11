export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}

/** All backend calls go through here: consistent errors, cookies included, network failures explained. */
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method, credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    const e = data?.error || {};
    throw new ApiError(res.status, e.code || 'ERROR', e.message || `Request failed (${res.status})`, e.details);
  }
  return data;
}

import { alternativesFrom } from './lib/routeLogic.js';
import { haversine } from './lib/geo.js';
import { syncOffline, readCache } from './lib/offline.js';

const isNetwork = (e) => e instanceof ApiError && e.code === 'NETWORK';

// ── Public reads (with offline fallback) ─────────────────────────────────────

/** All active locations (for map markers). Falls back to IndexedDB when offline. */
export async function getLocations() {
  try { return (await api('/locations')).items; }
  catch (e) {
    if (!isNetwork(e)) throw e;
    const c = await readCache().catch(() => null);
    if (c && c.locations.length) return c.locations.sort((a, b) => a.name.localeCompare(b.name));
    throw e;
  }
}

/** Search locations by partial name (autocomplete). */
export async function searchLocations(q, limit = 10) {
  try { return (await api(`/locations/search?q=${encodeURIComponent(q)}&limit=${limit}`)).items; }
  catch (e) {
    if (!isNetwork(e)) throw e;
    const c = await readCache().catch(() => null);
    if (!c) throw e;
    const lq = q.toLowerCase();
    return c.locations
      .filter((l) => l.name.toLowerCase().includes(lq))
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(lq);
        const bStarts = b.name.toLowerCase().startsWith(lq);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, limit);
  }
}

export const getLocation = (id) => api(`/locations/${id}`);

/** Routes between two locations. Falls back to IndexedDB when offline. */
export async function getRoutes(from, to) {
  try { return await api(`/routes?from=${from}&to=${to}`); }
  catch (e) {
    if (!isNetwork(e)) throw e;
    const c = await readCache().catch(() => null);
    if (!c || !c.routes.length) throw new ApiError(0, 'NETWORK', 'You are offline and no routes are saved on this device yet. Open the app once with internet to enable offline use.');
    const items = alternativesFrom(c.routes, Number(from), Number(to));
    return { items, offline: true, message: items.length ? undefined : 'No verified route is currently available between these locations (offline data).' };
  }
}

/** Closest registered buildings to a GPS fix. Falls back to haversine offline. */
export async function getNearest(lat, lng) {
  try { return (await api(`/locations/nearest?lat=${lat}&lng=${lng}`)).items; }
  catch (e) {
    if (!isNetwork(e)) throw e;
    const c = await readCache().catch(() => null);
    if (!c) throw e;
    const p = { latitude: lat, longitude: lng };
    return c.locations
      .map((l) => ({ ...l, distanceMeters: Math.round(haversine(p, l)) }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, 3);
  }
}

export const syncOfflineData = () => syncOffline(() => api('/offline/snapshot'));
export const offlineStatus   = () => readCache().then((c) => ({ syncedAt: c.syncedAt, routes: c.routes.length })).catch(() => ({ syncedAt: null, routes: 0 }));

// ── Auth ─────────────────────────────────────────────────────────────────────
export const login          = (email, password) => api('/auth/login', { method: 'POST', body: { email, password } });
export const logout         = () => api('/auth/logout', { method: 'POST' });
export const me             = () => api('/auth/me');
export const changePassword = (currentPassword, newPassword) => api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
export const forgotPassword = (email) => api('/auth/forgot-password', { method: 'POST', body: { email } });
export const resetPassword  = (token, newPassword) => api('/auth/reset-password', { method: 'POST', body: { token, newPassword } });

// ── Admin: Locations ──────────────────────────────────────────────────────────
export const adminLocationsAll   = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return api(`/admin/locations${qs ? '?' + qs : ''}`).then((d) => d.items);
};
export const adminLocations      = () => adminLocationsAll({ status: 'active' });
export const getAdminLocation    = (id) => api(`/admin/locations/${id}`);
export const createLocation      = (body) => api('/admin/locations', { method: 'POST', body });
export const updateLocation      = (id, body) => api(`/admin/locations/${id}`, { method: 'PUT', body });
export const deactivateLocation  = (id, expectedVersion) => api(`/admin/locations/${id}/deactivate`, { method: 'POST', body: { expectedVersion } });
export const reactivateLocation  = (id, expectedVersion) => api(`/admin/locations/${id}/reactivate`, { method: 'POST', body: { expectedVersion } });

export const getLocationVersions = (id, params = {}) => {
  const qs = new URLSearchParams({ limit: 20, offset: 0, ...params }).toString();
  return api(`/admin/locations/${id}/versions?${qs}`);
};
export const restoreLocation = (id, versionNumber, expectedVersion) =>
  api(`/admin/locations/${id}/restore`, { method: 'POST', body: { versionNumber, expectedVersion } });

// ── Admin: Image upload ───────────────────────────────────────────────────────
export async function uploadImage(file) {
  const form = new FormData();
  form.append('image', file);
  let res;
  try {
    res = await fetch('/api/admin/uploads/image', { method: 'POST', credentials: 'include', body: form });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error || {};
    throw new ApiError(res.status, e.code || 'ERROR', e.message || 'Upload failed');
  }
  return data; // { url }
}

// ── Admin: Routes ─────────────────────────────────────────────────────────────
export const adminRoutesList = (params = {}) => {
  const qs = new URLSearchParams({ limit: 15, offset: 0, ...params }).toString();
  return api(`/admin/routes?${qs}`);
};
export const getRoute        = (id) => api(`/admin/routes/${id}`);
export const createDraftRoute  = (body) => api('/admin/routes', { method: 'POST', body });
export const appendRoutePoints = (id, points) => api(`/admin/routes/${id}/points`, { method: 'POST', body: { points } });
export const updateRoute       = (id, body) => api(`/admin/routes/${id}`, { method: 'PUT', body });
export const publishRoute      = (id, expectedVersion) => api(`/admin/routes/${id}/publish`, { method: 'POST', body: { expectedVersion } });
export const deactivateRoute   = (id, expectedVersion) => api(`/admin/routes/${id}/deactivate`, { method: 'POST', body: { expectedVersion } });
export const reactivateRoute   = (id, expectedVersion) => api(`/admin/routes/${id}/reactivate`, { method: 'POST', body: { expectedVersion } });
export const discardRoute      = (id) => api(`/admin/routes/${id}`, { method: 'DELETE' });

export const getRouteVersions = (id, params = {}) => {
  const qs = new URLSearchParams({ limit: 20, offset: 0, ...params }).toString();
  return api(`/admin/routes/${id}/versions?${qs}`);
};
export const restoreRoute = (id, versionNumber, expectedVersion) =>
  api(`/admin/routes/${id}/restore`, { method: 'POST', body: { versionNumber, expectedVersion } });

// ── Admin: Users (Super Admin) ────────────────────────────────────────────────
export const listUsers  = () => api('/admin/users').then((d) => d.items);
export const createUser = (body) => api('/admin/users', { method: 'POST', body });
export const updateUser = (id, body) => api(`/admin/users/${id}`, { method: 'PATCH', body });

// ── Admin: Audit logs (Super Admin) ──────────────────────────────────────────
export const getAuditLogs = (params = {}) => {
  const qs = new URLSearchParams({ limit: 20, offset: 0, ...params }).toString();
  return api(`/admin/audit-logs?${qs}`);
};
