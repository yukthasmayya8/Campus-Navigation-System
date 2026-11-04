// IndexedDB cache of active locations + published routes (full geometry). Read-only data only:
// administration and anything that writes stays online-only.
const DB = 'campus-nav', VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('locations', { keyPath: 'locationId' });
      db.createObjectStore('routes', { keyPath: 'routeId' });
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
const all = (db, store) => new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/**
 * Downloads the snapshot and replaces the cache in ONE transaction (all-or-nothing, so a failed
 * download never leaves a half-updated cache). Records with an unchanged versionNumber are skipped;
 * deactivated ones disappear because the snapshot only contains active data.
 */
export async function syncOffline(fetchSnapshot) {
  const snap = await fetchSnapshot();
  const db = await open();
  try {
    const [oldL, oldR] = await Promise.all([all(db, 'locations'), all(db, 'routes')]);
    const tx = db.transaction(['locations', 'routes', 'meta'], 'readwrite');
    const sync = (store, fresh, old, key) => {
      const s = tx.objectStore(store); const oldMap = new Map(old.map((o) => [o[key], o.versionNumber])); const keep = new Set();
      fresh.forEach((x) => { keep.add(x[key]); if (oldMap.get(x[key]) !== x.versionNumber) s.put(x); });
      old.forEach((o) => { if (!keep.has(o[key])) s.delete(o[key]); });
    };
    sync('locations', snap.locations, oldL, 'locationId');
    sync('routes', snap.routes, oldR, 'routeId');
    tx.objectStore('meta').put({ key: 'syncedAt', value: snap.generatedAt });
    await done(tx);
    return snap.generatedAt;
  } finally { db.close(); }
}

export async function readCache() {
  const db = await open();
  try {
    const [locations, routes, meta] = await Promise.all([all(db, 'locations'), all(db, 'routes'), all(db, 'meta')]);
    return { locations, routes, syncedAt: meta.find((m) => m.key === 'syncedAt')?.value ?? null };
  } finally { db.close(); }
}
