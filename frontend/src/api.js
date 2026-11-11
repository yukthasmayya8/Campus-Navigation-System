export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

const configuredApiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const apiPrefix = configuredApiUrl.endsWith('/api') ? configuredApiUrl : `${configuredApiUrl}/api`;

export const apiUrl = (path) => `${apiPrefix}${path.startsWith('/') ? path : `/${path}`}`;

/** All backend calls go through here: consistent errors, cookies included, network failures explained. */
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(apiUrl(path), {
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

/** Public reads fall back to the IndexedDB cache when the network is unreachable. */
export async function getLocations() {
  try { return (await api('/locations')).items; }
  catch (e) {
    if (!isNetwork(e)) throw e;
    const c = await readCache().catch(() => null);
    if (c && c.locations.length) return c.locations.sort((a, b) => a.name.localeCompare(b.name));
    throw e;
  }
}
export const getLocation = (id) => api(`/locations/${id}`);

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

/** Closest registered buildings to a GPS fix (PostGIS on the server; haversine on cached data offline). */
export async function getNearest(lat, lng) {
  try { return (await api(`/locations/nearest?lat=${lat}&lng=${lng}`)).items; }
  catch (e) {
    if (!isNetwork(e)) throw e;
    const c = await readCache().catch(() => null);
    if (!c) throw e;
    const p = { latitude: lat, longitude: lng };
    return c.locations.map((l) => ({ ...l, distanceMeters: Math.round(haversine(p, l)) })).sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 3);
  }
}

export const syncOfflineData = () => syncOffline(() => api('/offline/snapshot'));
export const offlineStatus = () => readCache().then((c) => ({ syncedAt: c.syncedAt, routes: c.routes.length })).catch(() => ({ syncedAt: null, routes: 0 }));

export const login = (email, password) => api('/auth/login', { method: 'POST', body: { email, password } });
export const logout = () => api('/auth/logout', { method: 'POST' });
export const me = () => api('/auth/me');
export const changePassword = (currentPassword, newPassword) =>
  api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });

/* ---- admin: route recording ---- */
export const adminLocations = () => api('/admin/locations?status=active').then((d) => d.items);
export const createDraftRoute = (body) => api('/admin/routes', { method: 'POST', body });
export const appendRoutePoints = (id, points) => api(`/admin/routes/${id}/points`, { method: 'POST', body: { points } });
export const updateRoute = (id, body) => api(`/admin/routes/${id}`, { method: 'PUT', body });
export const publishRoute = (id, expectedVersion) => api(`/admin/routes/${id}/publish`, { method: 'POST', body: { expectedVersion } });
export const discardRoute = (id) => api(`/admin/routes/${id}`, { method: 'DELETE' });
