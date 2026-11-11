import { getLocations } from '../api.js';
import { SEARCH_LIMIT, filterLocal } from './searchUtils.js';

// Same-origin by default (Vite proxy in dev). Set VITE_API_URL if the API lives elsewhere.
const API_BASE = import.meta.env?.VITE_API_URL ?? '';

export class SearchError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// GET /api/locations/search?q=&limit=  ->  { items: [Location] }
export async function fetchSuggestions(q, { signal, limit = SEARCH_LIMIT } = {}) {
  let res;
  try {
    res = await fetch(
      `${API_BASE}/api/locations/search?q=${encodeURIComponent(q)}&limit=${limit}`,
      { signal, headers: { Accept: 'application/json' } }
    );
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new SearchError('NETWORK', 'Network unreachable');
  }

  if (!res.ok) {
    let code = null;
    try {
      code = (await res.json())?.error?.code ?? null;
    } catch {
      /* body was not JSON */
    }
    // With a dev proxy, a stopped backend answers 5xx (no API error body) instead of
    // failing the fetch, so treat that the same as being offline.
    if (!code && res.status >= 500) throw new SearchError('NETWORK', 'Server unreachable');
    throw new SearchError(code ?? 'SERVER', `Search failed (${res.status})`);
  }

  const data = await res.json();
  return Array.isArray(data?.items) ? data.items : [];
}

// Offline path: getLocations() already falls back to the offline cache.
export async function searchCached(q, limit = SEARCH_LIMIT) {
  const all = await getLocations();
  const list = Array.isArray(all) ? all : all?.items ?? [];
  return filterLocal(list, q, limit);
}
