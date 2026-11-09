// Pure helpers for the search feature (no React, easy to unit test).

export const SEARCH_LIMIT = 8;

export const normalize = (s) => String(s ?? '').trim().toLowerCase();

export const locationId = (loc) => loc?.id ?? loc?.locationId ?? null;

// Cached locations should already be active-only, but guard anyway.
const isActive = (loc) =>
  loc && loc.status !== 'inactive' && loc.isActive !== false && loc.is_active !== false;

// Remove duplicates by ID only. Two different places can share a name, so
// de-duplicating by name would silently drop a valid suggestion.
export function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const loc of items) {
    if (!loc || !loc.name) continue;
    const key = locationId(loc) ?? `name:${normalize(loc.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(loc);
  }
  return out;
}

// Stable partition: names that start with the query first, order otherwise kept.
// The backend already does this; repeating it is cheap and keeps the UI correct
// if the order ever changes.
export function prefixFirst(items, query) {
  const q = normalize(query);
  const starts = [];
  const rest = [];
  for (const loc of items) {
    (normalize(loc.name).startsWith(q) ? starts : rest).push(loc);
  }
  return [...starts, ...rest];
}

// Offline fallback. Uses plain includes(), so "%" and "_" are literal characters
// here and never act as wildcards.
export function filterLocal(all, query, limit = SEARCH_LIMIT) {
  const q = normalize(query);
  if (!q) return [];
  const matches = all.filter((l) => isActive(l) && l.name && normalize(l.name).includes(q));
  const starts = matches
    .filter((l) => normalize(l.name).startsWith(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  const rest = matches
    .filter((l) => !normalize(l.name).startsWith(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...starts, ...rest].slice(0, limit);
}
