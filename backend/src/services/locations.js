const config = require('../config');
const { query, withTransaction } = require('../db');
const { badRequest, notFound, conflict, versionConflict } = require('../utils/errors');
const { escapeLike, diffSnapshots } = require('../utils/geo');
const { writeAudit, writeLocationVersion } = require('./audit');

const toLocation = (r) => ({
  locationId: r.location_id, name: r.name, description: r.description,
  latitude: r.latitude, longitude: r.longitude, imageUrl: r.image_url,
  status: r.status, versionNumber: r.version_number, createdAt: r.created_at, updatedAt: r.updated_at,
});
const snapshotOf = (r) => ({
  locationId: r.location_id, name: r.name, description: r.description,
  latitude: r.latitude, longitude: r.longitude, imageUrl: r.image_url, status: r.status,
});
const COLS = 'location_id, name, description, latitude, longitude, image_url, status, version_number, created_at, updated_at';

/* ---------- public ---------- */
async function listActive() {
  const { rows } = await query(`SELECT ${COLS} FROM locations WHERE status='active' ORDER BY lower(name)`);
  return rows.map(toLocation);
}
async function getActive(id) {
  const { rows } = await query(`SELECT ${COLS} FROM locations WHERE location_id=$1 AND status='active'`, [id]);
  if (!rows[0]) throw notFound('Location');
  return toLocation(rows[0]);
}
/** Case-insensitive partial match; prefix matches ranked first, then alphabetical. */
async function searchActive(q, limit = 10) {
  const term = String(q || '').trim().slice(0, 100);
  if (!term) return [];
  const { rows } = await query(
    `SELECT ${COLS} FROM locations
      WHERE status='active' AND lower(name) LIKE '%' || lower($1) || '%' ESCAPE '\\'
      ORDER BY (lower(name) LIKE lower($1) || '%' ESCAPE '\\') DESC, lower(name)
      LIMIT $2`, [escapeLike(term), limit]);
  return rows.map(toLocation);
}

/** PostGIS KNN: closest active buildings to a GPS fix (used for auto start detection / rerouting). */
async function nearestActive(lat, lng, limit = 3) {
  const { rows } = await query(
    `SELECT ${COLS}, round(ST_Distance(geom, p.g)::numeric, 1)::float AS distance_m
       FROM locations, (SELECT ST_SetSRID(ST_MakePoint($2,$1),4326)::geography AS g) p
      WHERE status='active' ORDER BY geom <-> p.g LIMIT $3`, [lat, lng, limit]);
  return rows.map((r) => ({ ...toLocation(r), distanceMeters: r.distance_m }));
}

/* ---------- admin ---------- */
async function listAll({ status, q } = {}) {
  const params = []; const where = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (q) { params.push(escapeLike(q)); where.push(`lower(name) LIKE '%' || lower($${params.length}) || '%' ESCAPE '\\'`); }
  const { rows } = await query(
    `SELECT ${COLS} FROM locations ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY lower(name)`, params);
  return rows.map(toLocation);
}
async function getAny(id) {
  const { rows } = await query(`SELECT ${COLS} FROM locations WHERE location_id=$1`, [id]);
  if (!rows[0]) throw notFound('Location');
  return toLocation(rows[0]);
}

/** PostGIS: active locations within the configured radius of a point. */
async function findNearby(client, lat, lng, excludeId = null) {
  const { rows } = await client.query(
    `SELECT location_id, name, round(ST_Distance(geom, p.g)::numeric, 1)::float AS distance_m
       FROM locations, (SELECT ST_SetSRID(ST_MakePoint($2,$1),4326)::geography AS g) p
      WHERE status='active' AND ST_DWithin(geom, p.g, $3) AND ($4::bigint IS NULL OR location_id <> $4)
      ORDER BY distance_m LIMIT 5`, [lat, lng, config.duplicateRadiusM, excludeId]);
  return rows.map((r) => ({ locationId: r.location_id, name: r.name, distanceMeters: r.distance_m }));
}
async function assertNoNearby(client, lat, lng, confirmed, excludeId) {
  if (confirmed) return;
  const nearby = await findNearby(client, lat, lng, excludeId);
  if (nearby.length)
    throw conflict(`Another active location is within ${config.duplicateRadiusM} m. Confirm to register anyway.`,
      { nearby }, 'NEARBY_LOCATION');
}

async function create(user, data) {
  return withTransaction(async (c) => {
    await assertNoNearby(c, data.latitude, data.longitude, data.confirmNearby, null);
    const { rows } = await c.query(
      `INSERT INTO locations (name, description, latitude, longitude, image_url)
       VALUES ($1,$2,$3,$4,$5) RETURNING ${COLS}`,
      [data.name, data.description || '', data.latitude, data.longitude, data.imageUrl ?? null]);
    const row = rows[0]; const snap = snapshotOf(row);
    await writeLocationVersion(c, snap, row.version_number, user.id, 'Location registered');
    await writeAudit(c, { userId: user.id, action: 'location.create', entityType: 'location', entityId: row.location_id, next: snap });
    return toLocation(row);
  });
}

/** Locks the row, verifies expected version (optimistic locking) and returns it. */
async function lockAndCheck(c, id, expected) {
  const { rows } = await c.query(`SELECT ${COLS} FROM locations WHERE location_id=$1 FOR UPDATE`, [id]);
  if (!rows[0]) throw notFound('Location');
  if (rows[0].version_number !== expected) throw versionConflict('Location', expected, toLocation(rows[0]));
  return rows[0];
}

async function applyChange(c, user, before, newValues, action, description) {
  const { rows } = await c.query(
    `UPDATE locations SET name=$2, description=$3, latitude=$4, longitude=$5, image_url=$6, status=$7,
            version_number = version_number + 1, updated_at = now()
      WHERE location_id=$1 RETURNING ${COLS}`,
    [before.location_id, newValues.name, newValues.description, newValues.latitude, newValues.longitude, newValues.imageUrl, newValues.status]);
  const after = rows[0]; const snap = snapshotOf(after);
  await writeLocationVersion(c, snap, after.version_number, user.id, description);
  await writeAudit(c, { userId: user.id, action, entityType: 'location', entityId: after.location_id, previous: snapshotOf(before), next: snap });
  return toLocation(after);
}

async function update(user, id, data) {
  return withTransaction(async (c) => {
    const before = await lockAndCheck(c, id, data.expectedVersion);
    const next = {
      name: data.name ?? before.name, description: data.description ?? before.description,
      latitude: data.latitude ?? before.latitude, longitude: data.longitude ?? before.longitude,
      imageUrl: data.imageUrl !== undefined ? data.imageUrl : before.image_url, status: before.status,
    };
    const moved = next.latitude !== before.latitude || next.longitude !== before.longitude;
    if (moved && before.status === 'active') await assertNoNearby(c, next.latitude, next.longitude, data.confirmNearby, id);
    return applyChange(c, user, before, next, 'location.update', moved ? 'Location edited / coordinates corrected' : 'Location edited');
  });
}

async function setStatus(user, id, expected, status) {
  return withTransaction(async (c) => {
    const before = await lockAndCheck(c, id, expected);
    if (before.status === status) throw conflict(`Location is already ${status}`, undefined, 'NO_CHANGE');
    const next = { name: before.name, description: before.description, latitude: before.latitude, longitude: before.longitude, imageUrl: before.image_url, status };
    return applyChange(c, user, before, next, status === 'active' ? 'location.reactivate' : 'location.deactivate',
      status === 'active' ? 'Location reactivated' : 'Location deactivated');
  });
}

/** Super Admin: restore a historical snapshot as a NEW version (history is never rewritten). */
async function restore(user, id, versionNumber, expected) {
  return withTransaction(async (c) => {
    const before = await lockAndCheck(c, id, expected);
    const { rows } = await c.query(
      `SELECT snapshot_data FROM location_versions WHERE location_id=$1 AND version_number=$2`, [id, versionNumber]);
    if (!rows[0]) throw notFound(`Version ${versionNumber} of this location`);
    const s = rows[0].snapshot_data;
    const next = { name: s.name, description: s.description, latitude: s.latitude, longitude: s.longitude, imageUrl: s.imageUrl ?? null, status: s.status };
    return applyChange(c, user, before, next, 'location.restore', `Restored from version ${versionNumber}`);
  });
}

/* ---------- history ---------- */
async function history(id, limit, offset) {
  const exists = await query('SELECT 1 FROM locations WHERE location_id=$1', [id]);
  if (!exists.rows[0]) throw notFound('Location');
  const [{ rows }, { rows: cnt }] = await Promise.all([
    query(`SELECT v.version_number, v.modified_at, v.change_description, v.modified_by, u.name AS modified_by_name
             FROM location_versions v LEFT JOIN users u ON u.user_id = v.modified_by
            WHERE v.location_id=$1 ORDER BY v.version_number DESC LIMIT $2 OFFSET $3`, [id, limit, offset]),
    query('SELECT count(*) AS n FROM location_versions WHERE location_id=$1', [id]),
  ]);
  return {
    total: cnt[0].n, limit, offset,
    items: rows.map((r) => ({ versionNumber: r.version_number, modifiedAt: r.modified_at, changeDescription: r.change_description,
      modifiedBy: r.modified_by, modifiedByName: r.modified_by_name })),
  };
}
async function getVersion(id, n) {
  const { rows } = await query(
    `SELECT version_number, snapshot_data, modified_at, change_description FROM location_versions WHERE location_id=$1 AND version_number=$2`, [id, n]);
  if (!rows[0]) throw notFound(`Version ${n}`);
  return { versionNumber: rows[0].version_number, modifiedAt: rows[0].modified_at, changeDescription: rows[0].change_description, snapshot: rows[0].snapshot_data };
}
async function compare(id, a, b) {
  if (a === b) throw badRequest('Choose two different versions to compare');
  const [va, vb] = await Promise.all([getVersion(id, a), getVersion(id, b)]);
  return { from: a, to: b, changes: diffSnapshots(va.snapshot, vb.snapshot) };
}

module.exports = { nearestActive, listActive, getActive, searchActive, listAll, getAny, create, update, setStatus, restore, history, getVersion, compare, findNearby, toLocation };
