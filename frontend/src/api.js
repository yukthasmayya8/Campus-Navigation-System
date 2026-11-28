export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.details = details;
  }
}

const configuredApiUrl = (import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || '')).replace(/\/+$/, '');
const apiPrefix = configuredApiUrl.endsWith('/api') ? configuredApiUrl : `${configuredApiUrl}/api`;

export const apiUrl = (path) => `${apiPrefix}${path.startsWith('/') ? path : `/${path}`}`;

/** Every backend call goes through here: cookies included, consistent errors. */
export async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(apiUrl(path), {
      method, credentials: 'include', signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
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

/** Human-readable message for an ApiError (used by both public and admin screens). */
export function errorMessage(err) {
  if (!err) return '';
  if (err.code === 'NETWORK' || err.status === 0) return 'Cannot reach the server. Check your connection and try again.';
  if (err.status === 403) return 'You do not have permission for this action.';
  if (err.code === 'VERSION_CONFLICT') return 'Someone else changed this record. Reload to see the latest version.';
  const details = Array.isArray(err.details) ? err.details.map((d) => d?.message || d).filter(Boolean) : [];
  return [err.message || 'Something went wrong.', ...details].join(' ');
}

const qs = (params = {}) => {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') s.set(k, v); });
  const t = s.toString();
  return t ? `?${t}` : '';
};

import { haversine } from './lib/geo.js';

/* ── Public reads (offline-aware) ─────────────────────────────────────────── */
let offline = null;
async function offlineHelpers() {
  if (!offline) offline = await import('./lib/offline.js');
  return offline;
}
const isNetwork = (e) => e instanceof ApiError && e.code === 'NETWORK';

export async function getLocations() {
  try { return (await api('/locations')).items; }
  catch (e) {
    if (!isNetwork(e)) throw e;
    const c = await offlineHelpers().then((m) => m.readCache()).catch(() => null);
    if (c?.locations?.length) return c.locations.slice().sort((a, b) => a.name.localeCompare(b.name));
    throw e;
  }
}

export async function searchLocations(q, limit = 8) {
  try { return (await api(`/locations/search${qs({ q, limit })}`)).items; }
  catch (e) {
    if (!isNetwork(e)) throw e;
    const c = await offlineHelpers().then((m) => m.readCache()).catch(() => null);
    if (!c) throw e;
    const term = q.toLowerCase();
    return c.locations
      .filter((l) => l.name.toLowerCase().includes(term))
      .sort((a, b) => (a.name.toLowerCase().startsWith(term) === b.name.toLowerCase().startsWith(term)
        ? a.name.localeCompare(b.name) : a.name.toLowerCase().startsWith(term) ? -1 : 1))
      .slice(0, limit);
  }
}

export const getLocation = (id) => api(`/locations/${id}`);

export async function getRoutes(from, to) {
  try { return await api(`/routes${qs({ from, to })}`); }
  catch (e) {
    if (!isNetwork(e)) throw e;
    const { readCache } = await offlineHelpers();
    const { alternativesFrom } = await import('./lib/routeLogic.js');
    const c = await readCache().catch(() => null);
    if (!c || !c.routes.length) throw new ApiError(0, 'NETWORK', 'You are offline and no routes are saved on this device yet. Open the app once with internet to enable offline use.');
    const items = alternativesFrom(c.routes, Number(from), Number(to));
    return { items, offline: true, message: items.length ? undefined : 'No verified route is currently available between these locations (offline data).' };
  }
}

export async function getNearest(lat, lng) {
  try { return (await api(`/locations/nearest${qs({ lat, lng })}`)).items; }
  catch (e) {
    if (!isNetwork(e)) throw e;
    const { readCache } = await offlineHelpers();
    const c = await readCache().catch(() => null);
    if (!c) throw e;
    const p = { latitude: lat, longitude: lng };
    return c.locations.map((l) => ({ ...l, distanceMeters: Math.round(haversine(p, l)) }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 3);
  }
}

export const submitLocationSuggestion = (body) => api('/location-suggestions', { method: 'POST', body });

export const syncOfflineData = async () => (await offlineHelpers()).syncOffline(() => api('/offline/snapshot'));
export const offlineStatus = async () => (await offlineHelpers()).readCache()
  .then((c) => ({ syncedAt: c.syncedAt, routes: c.routes.length }))
  .catch(() => ({ syncedAt: null, routes: 0 }));

/* ── Auth ─────────────────────────────────────────────────────────────────── */
export const login = (email, password) => api('/auth/login', { method: 'POST', body: { email, password } });
export const logout = () => api('/auth/logout', { method: 'POST' });
export const me = () => api('/auth/me');
export const changePassword = (currentPassword, newPassword) => api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
export const forgotPassword = (email) => api('/auth/forgot-password', { method: 'POST', body: { email } });
export const resetPassword = (token, newPassword) => api('/auth/reset-password', { method: 'POST', body: { token, newPassword } });

/* ── Admin: locations ─────────────────────────────────────────────────────── */
export const adminLocationsAll = (params = {}) => api(`/admin/locations${qs(params)}`).then((d) => d.items);
export const adminLocations = () => adminLocationsAll({ status: 'active' });
export const getAdminLocation = (id) => api(`/admin/locations/${id}`);
export const createLocation = (body) => api('/admin/locations', { method: 'POST', body });
export const updateLocation = (id, body) => api(`/admin/locations/${id}`, { method: 'PUT', body });
export const deactivateLocation = (id, expectedVersion) => api(`/admin/locations/${id}/deactivate`, { method: 'POST', body: { expectedVersion } });
export const reactivateLocation = (id, expectedVersion) => api(`/admin/locations/${id}/reactivate`, { method: 'POST', body: { expectedVersion } });
export const nearbyLocations = (lat, lng) => api(`/admin/locations/nearby${qs({ lat, lng })}`);
export const adminLocationSuggestions = (params = {}) => api(`/admin/location-suggestions${qs(params)}`).then((d) => d.items ? d : d);
export const getLocationSuggestion = (id) => api(`/admin/location-suggestions/${id}`);
export const updateLocationSuggestion = (id, body) => api(`/admin/location-suggestions/${id}`, { method: 'PUT', body });
export const approveLocationSuggestion = (id, body = {}) => api(`/admin/location-suggestions/${id}/approve`, { method: 'POST', body });
export const rejectLocationSuggestion = (id, body = {}) => api(`/admin/location-suggestions/${id}/reject`, { method: 'POST', body });

/* ── Admin: image upload (compressed client-side before sending) ──────────── */
async function compressImageFile(file, { maxWidth = 1600, maxHeight = 1600, quality = 0.82, maxBytes = 900000 } = {}) {
  if (!(file instanceof File) || !file.type.startsWith('image/')) return file;
  if (file.size <= maxBytes) return file;
  const loadImage = () => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
  try {
    const img = await loadImage();
    let { width, height } = img;
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);
    const toBlob = (type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));
    let blob = await toBlob('image/jpeg', quality);
    if (blob && blob.size > maxBytes) blob = await toBlob('image/jpeg', 0.72);
    if (blob && blob.size > maxBytes) blob = await toBlob('image/webp', 0.75);
    if (!blob || blob.size >= file.size) return file;
    const name = (file.name || 'upload').replace(/\.[^.]+$/, '') + (blob.type === 'image/webp' ? '.webp' : '.jpg');
    return new File([blob], name, { type: blob.type, lastModified: Date.now() });
  } catch { return file; }
}

export async function uploadImage(file) {
  const optimized = await compressImageFile(file);
  const form = new FormData();
  form.append('image', optimized, optimized.name || file.name);
  let res;
  try {
    res = await fetch(apiUrl('/admin/uploads/image'), { method: 'POST', credentials: 'include', body: form });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error || {};
    throw new ApiError(res.status, e.code || 'ERROR', e.message || 'Upload failed');
  }
  return data;
}

/* ── Admin: routes ────────────────────────────────────────────────────────── */
export const adminRoutesList = (params = {}) => api(`/admin/routes${qs({ limit: 15, offset: 0, ...params })}`);
export const getRoute = (id) => api(`/admin/routes/${id}`);
export const createDraftRoute = (body) => api('/admin/routes', { method: 'POST', body });
export const appendRoutePoints = (id, points) => api(`/admin/routes/${id}/points`, { method: 'POST', body: { points } });
export const updateRoute = (id, body) => api(`/admin/routes/${id}`, { method: 'PUT', body });
export const publishRoute = (id, expectedVersion) => api(`/admin/routes/${id}/publish`, { method: 'POST', body: { expectedVersion } });
export const deactivateRoute = (id, expectedVersion) => api(`/admin/routes/${id}/deactivate`, { method: 'POST', body: { expectedVersion } });
export const reactivateRoute = (id, expectedVersion) => api(`/admin/routes/${id}/reactivate`, { method: 'POST', body: { expectedVersion } });
export const discardRoute = (id) => api(`/admin/routes/${id}`, { method: 'DELETE' });

/* ── Admin: version history ───────────────────────────────────────────────── */
const historyBase = (type, id) => `/admin/${type === 'route' ? 'routes' : 'locations'}/${id}/versions`;
export const getVersions = (type, id, params = {}) => api(`${historyBase(type, id)}${qs({ limit: 20, offset: 0, ...params })}`);
export const getVersion = (type, id, versionNumber) => api(`${historyBase(type, id)}/${versionNumber}`);
export const compareVersions = (type, id, from, to) => api(`${historyBase(type, id)}/compare${qs({ from, to })}`);
export const restoreVersion = (type, id, versionNumber, expectedVersion) =>
  api(`/admin/${type === 'route' ? 'routes' : 'locations'}/${id}/restore`, { method: 'POST', body: { versionNumber, expectedVersion } });

/* ── Super Admin ──────────────────────────────────────────────────────────── */
export const listUsers = () => api('/admin/users').then((d) => d.items);
export const createUser = (body) => api('/admin/users', { method: 'POST', body });
export const updateUser = (id, body) => api(`/admin/users/${id}`, { method: 'PATCH', body });
export const getAuditLogs = (params = {}) => api(`/admin/audit-logs${qs({ limit: 20, offset: 0, ...params })}`);
