const config = require('../config');
const { query, withTransaction } = require('../db');
const { badRequest, notFound, conflict, versionConflict } = require('../utils/errors');
const { reverseRoute, compareRoutes, diffSnapshots } = require('../utils/geo');
const { writeAudit, writeRouteVersion } = require('./audit');

const RCOLS = `route_id, source_location_id, destination_location_id, route_name, directionality,
  has_stairs, has_ramp, is_covered, notes, status, version_number, created_by, created_at, updated_at`;

const mapPoint = (p) => ({ sequenceNumber: p.sequence_number, latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy, recordedAt: p.recorded_at });
const mapWaypoint = (w) => ({ sequenceNumber: w.sequence_number, locationId: w.location_id, name: w.name, isActive: w.status === 'active' });
const mapRoute = (r) => ({
  routeId: r.route_id, sourceLocationId: r.source_location_id, destinationLocationId: r.destination_location_id,
  routeName: r.route_name, directionality: r.directionality,
  hasStairs: r.has_stairs, hasRamp: r.has_ramp, isCovered: r.is_covered, // null = "Not verified"
  notes: r.notes, status: r.status, versionNumber: r.version_number, createdBy: r.created_by,
  createdAt: r.created_at, updatedAt: r.updated_at, reversed: false,
  distanceMeters: r.distance_m == null ? null : Math.round(r.distance_m),
});

async function loadChildren(db, routeIds) {
  if (!routeIds.length) return { points: new Map(), waypoints: new Map() };
  const [p, w] = await Promise.all([
    db.query(`SELECT route_id, sequence_number, latitude, longitude, accuracy, recorded_at FROM route_points
               WHERE route_id = ANY($1::bigint[]) ORDER BY route_id, sequence_number`, [routeIds]),
    db.query(`SELECT rw.route_id, rw.sequence_number, rw.location_id, l.name, l.status FROM route_waypoints rw
                JOIN locations l ON l.location_id = rw.location_id
               WHERE rw.route_id = ANY($1::bigint[]) ORDER BY rw.route_id, rw.sequence_number`, [routeIds]),
  ]);
  const points = new Map(); const waypoints = new Map();
  routeIds.forEach((id) => { points.set(id, []); waypoints.set(id, []); });
  p.rows.forEach((r) => points.get(r.route_id).push(mapPoint(r)));
  w.rows.forEach((r) => waypoints.get(r.route_id).push(mapWaypoint(r)));
  return { points, waypoints };
}

async function hydrate(db, rows) {
  const { points, waypoints } = await loadChildren(db, rows.map((r) => r.route_id));
  return rows.map((r) => ({ ...mapRoute(r), points: points.get(r.route_id), waypoints: waypoints.get(r.route_id) }));
}

/* ---------- public ---------- */
/**
 * Alternatives for start -> destination. A route is publicly eligible only when route AND both
 * endpoint locations are active (computed live, no stored effective_status). Draft/inactive never appear.
 * Reverse match only for verified bidirectional routes; reversed copy is built in memory.
 */
async function alternatives(fromId, toId) {
  if (fromId === toId) throw badRequest('Start and destination must be different');
  const { rows } = await query(
    `SELECT ${RCOLS.split(',').map((c) => 'r.' + c.trim()).join(', ')},
       (SELECT ST_Length(ST_MakeLine(p.geom::geometry ORDER BY p.sequence_number)::geography) FROM route_points p WHERE p.route_id = r.route_id) AS distance_m
       FROM routes r
       JOIN locations s ON s.location_id = r.source_location_id
       JOIN locations d ON d.location_id = r.destination_location_id
      WHERE r.status='active' AND s.status='active' AND d.status='active'
        AND ((r.source_location_id=$1 AND r.destination_location_id=$2)
          OR (r.source_location_id=$2 AND r.destination_location_id=$1 AND r.directionality='bidirectional'))`, [fromId, toId]);
  const full = await hydrate({ query }, rows);
  return full.map((r) => (r.sourceLocationId === fromId ? r : reverseRoute(r))).sort(compareRoutes);
}

/** Every publicly eligible route (forward direction only) for the offline cache; clients derive reverse matches. */
async function publishedForOffline() {
  const { rows } = await query(
    `SELECT ${RCOLS.split(',').map((c) => 'r.' + c.trim()).join(', ')},
       (SELECT ST_Length(ST_MakeLine(p.geom::geometry ORDER BY p.sequence_number)::geography) FROM route_points p WHERE p.route_id = r.route_id) AS distance_m
       FROM routes r
       JOIN locations s ON s.location_id = r.source_location_id
       JOIN locations d ON d.location_id = r.destination_location_id
      WHERE r.status='active' AND s.status='active' AND d.status='active' ORDER BY r.route_id`);
  return hydrate({ query }, rows);
}

/* ---------- admin reads ---------- */
async function listAdmin({ status, sourceLocationId, destinationLocationId, limit, offset }) {
  const params = []; const where = [];
  if (status) { params.push(status); where.push(`status=$${params.length}`); }
  if (sourceLocationId) { params.push(sourceLocationId); where.push(`source_location_id=$${params.length}`); }
  if (destinationLocationId) { params.push(destinationLocationId); where.push(`destination_location_id=$${params.length}`); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  params.push(limit, offset);
  const [{ rows }, { rows: c }] = await Promise.all([
    query(`SELECT ${RCOLS}, (SELECT count(*) FROM route_points p WHERE p.route_id = routes.route_id) AS point_count
             FROM routes ${w} ORDER BY route_id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
    query(`SELECT count(*) AS n FROM routes ${w}`, params.slice(0, -2)),
  ]);
  return { total: c[0].n, limit, offset, items: rows.map((r) => ({ ...mapRoute(r), pointCount: r.point_count })) };
}
async function getAdmin(id, db = { query }) {
  const { rows } = await db.query(`SELECT ${RCOLS} FROM routes WHERE route_id=$1`, [id]);
  if (!rows[0]) throw notFound('Route');
  return (await hydrate(db, rows))[0];
}

/* ---------- helpers for writes ---------- */
async function assertLocationsActive(c, ids, label) {
  const unique = [...new Set(ids)];
  const { rows } = await c.query(`SELECT location_id, status FROM locations WHERE location_id = ANY($1::bigint[])`, [unique]);
  const found = new Map(rows.map((r) => [r.location_id, r.status]));
  const missing = unique.filter((i) => !found.has(i));
  const inactive = unique.filter((i) => found.get(i) === 'inactive');
  if (missing.length) throw badRequest(`${label}: location(s) not registered`, { locationIds: missing });
  if (inactive.length) throw badRequest(`${label}: location(s) are inactive and cannot be used`, { locationIds: inactive });
}

async function insertPoints(c, routeId, points, startSeq = 1, ignoreDup = false) {
  if (!points.length) return 0;
  const seq = points.map((p, i) => p.sequenceNumber ?? startSeq + i);
  const { rowCount } = await c.query(
    `INSERT INTO route_points (route_id, sequence_number, latitude, longitude, accuracy, recorded_at)
     SELECT $1, * FROM unnest($2::int[], $3::float8[], $4::float8[], $5::float8[], $6::timestamptz[])
     ${ignoreDup ? 'ON CONFLICT (route_id, sequence_number) DO NOTHING' : ''}`,
    [routeId, seq, points.map((p) => p.latitude), points.map((p) => p.longitude),
     points.map((p) => p.accuracy ?? null), points.map((p) => p.recordedAt ?? null)]);
  return rowCount;
}
async function replacePoints(c, routeId, points) {
  await c.query('DELETE FROM route_points WHERE route_id=$1', [routeId]);
  // Whole-route replacement ignores client sequence numbers: array order is the order.
  await insertPoints(c, routeId, points.map((p) => ({ ...p, sequenceNumber: undefined })));
}
async function replaceWaypoints(c, routeId, ids) {
  await c.query('DELETE FROM route_waypoints WHERE route_id=$1', [routeId]);
  if (!ids.length) return;
  await c.query(
    `INSERT INTO route_waypoints (route_id, location_id, sequence_number)
     SELECT $1, loc, ord FROM unnest($2::bigint[]) WITH ORDINALITY AS t(loc, ord)`, [routeId, ids]);
}

/** Complete snapshot: metadata + ordered points + ordered waypoints from the SAME transaction. */
async function snapshot(c, routeId) {
  const r = await getAdmin(routeId, c);
  return {
    routeId: r.routeId, sourceLocationId: r.sourceLocationId, destinationLocationId: r.destinationLocationId,
    routeName: r.routeName, directionality: r.directionality, hasStairs: r.hasStairs, hasRamp: r.hasRamp,
    isCovered: r.isCovered, notes: r.notes, status: r.status,
    points: r.points, waypoints: r.waypoints.map((w) => ({ sequenceNumber: w.sequenceNumber, locationId: w.locationId })),
  };
}

async function lockAndCheck(c, id, expected) {
  const { rows } = await c.query(`SELECT ${RCOLS} FROM routes WHERE route_id=$1 FOR UPDATE`, [id]);
  if (!rows[0]) throw notFound('Route');
  if (rows[0].version_number !== expected) throw versionConflict('Route', expected, mapRoute(rows[0]));
  return rows[0];
}
const pointCount = async (c, id) => (await c.query('SELECT count(*) AS n FROM route_points WHERE route_id=$1', [id])).rows[0].n;

async function finishVersioned(c, user, id, before, action, description) {
  const snap = await snapshot(c, id);
  const { rows } = await c.query('SELECT version_number FROM routes WHERE route_id=$1', [id]);
  await writeRouteVersion(c, snap, rows[0].version_number, user.id, description);
  await writeAudit(c, { userId: user.id, action, entityType: 'route', entityId: id, previous: before, next: snap });
  return getAdmin(id, c);
}
const bump = (c, id) => c.query('UPDATE routes SET version_number = version_number + 1, updated_at = now() WHERE route_id=$1', [id]);

/* ---------- writes ---------- */
async function createDraft(user, d) {
  return withTransaction(async (c) => {
    await assertLocationsActive(c, [d.sourceLocationId, d.destinationLocationId], 'Route endpoints');
    if (d.waypointLocationIds.length) await assertLocationsActive(c, d.waypointLocationIds, 'Waypoints');
    const { rows } = await c.query(
      `INSERT INTO routes (source_location_id, destination_location_id, route_name, directionality, has_stairs, has_ramp, is_covered, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9) RETURNING route_id`,
      [d.sourceLocationId, d.destinationLocationId, d.routeName, d.directionality, d.hasStairs, d.hasRamp, d.isCovered, d.notes ?? null, user.id]);
    const id = rows[0].route_id;
    await replacePoints(c, id, d.points);
    await replaceWaypoints(c, id, d.waypointLocationIds);
    return finishVersioned(c, user, id, null, 'route.create_draft', 'Draft created');
  });
}

/**
 * Live recording: append GPS points to a DRAFT. Not versioned per batch (a walk produces many batches);
 * the complete geometry is captured in the snapshot when the draft is saved/published.
 * If the client supplies sequenceNumber, retries are idempotent (duplicates ignored).
 */
async function appendPoints(user, id, points) {
  return withTransaction(async (c) => {
    const { rows } = await c.query(`SELECT status FROM routes WHERE route_id=$1 FOR UPDATE`, [id]);
    if (!rows[0]) throw notFound('Route');
    if (rows[0].status !== 'draft') throw conflict('Points can only be added to a draft route', undefined, 'NOT_A_DRAFT');
    const { rows: m } = await c.query('SELECT coalesce(max(sequence_number),0) AS m, count(*) AS n FROM route_points WHERE route_id=$1', [id]);
    if (m[0].n + points.length > config.limits.maxPointsPerRoute)
      throw badRequest(`A route can hold at most ${config.limits.maxPointsPerRoute} points`);
    const inserted = await insertPoints(c, id, points, m[0].m + 1, true);
    return { routeId: id, received: points.length, inserted, totalPoints: m[0].n + inserted };
  });
}

async function update(user, id, d) {
  return withTransaction(async (c) => {
    const before = await lockAndCheck(c, id, d.expectedVersion);
    const beforeSnap = await snapshot(c, id);
    const src = d.sourceLocationId ?? before.source_location_id;
    const dst = d.destinationLocationId ?? before.destination_location_id;
    if (src === dst) throw badRequest('Source and destination must differ');
    if (src !== before.source_location_id || dst !== before.destination_location_id)
      await assertLocationsActive(c, [src, dst], 'Route endpoints');
    if (d.waypointLocationIds) await assertLocationsActive(c, d.waypointLocationIds, 'Waypoints');
    const n = d.points ? d.points.length : await pointCount(c, id);
    if (before.status !== 'draft' && n < 2) throw badRequest('A published route needs at least 2 recorded points');

    await c.query(
      `UPDATE routes SET source_location_id=$2, destination_location_id=$3, route_name=$4, directionality=$5,
              has_stairs=$6, has_ramp=$7, is_covered=$8, notes=$9 WHERE route_id=$1`,
      [id, src, dst, d.routeName ?? before.route_name, d.directionality ?? before.directionality,
       d.hasStairs !== undefined ? d.hasStairs : before.has_stairs,
       d.hasRamp !== undefined ? d.hasRamp : before.has_ramp,
       d.isCovered !== undefined ? d.isCovered : before.is_covered,
       d.notes !== undefined ? d.notes : before.notes]);
    if (d.points) await replacePoints(c, id, d.points);
    if (d.waypointLocationIds) await replaceWaypoints(c, id, d.waypointLocationIds);
    await bump(c, id);
    return finishVersioned(c, user, id, beforeSnap, 'route.update', 'Route edited');
  });
}

const TRANSITIONS = {
  publish:    { from: 'draft',    to: 'active',   action: 'route.publish',    text: 'Draft published' },
  deactivate: { from: 'active',   to: 'inactive', action: 'route.deactivate', text: 'Route deactivated' },
  reactivate: { from: 'inactive', to: 'active',   action: 'route.reactivate', text: 'Route reactivated' },
};
async function changeStatus(user, id, expected, kind) {
  const t = TRANSITIONS[kind];
  return withTransaction(async (c) => {
    const before = await lockAndCheck(c, id, expected);
    if (before.status !== t.from) throw conflict(`Only a ${t.from} route can be ${kind === 'publish' ? 'published' : kind + 'd'} (currently ${before.status})`, undefined, 'INVALID_STATE');
    if (t.to === 'active') {
      if ((await pointCount(c, id)) < 2) throw badRequest('Record at least 2 GPS points before publishing');
      await assertLocationsActive(c, [before.source_location_id, before.destination_location_id], 'Route endpoints');
      if (kind === 'publish') { // every waypoint must still be registered AND active when a draft goes live
        const w = await c.query('SELECT location_id FROM route_waypoints WHERE route_id=$1', [id]);
        if (w.rows.length) await assertLocationsActive(c, w.rows.map((x) => x.location_id), 'Waypoints');
      }
    }
    const beforeSnap = await snapshot(c, id);
    await c.query('UPDATE routes SET status=$2 WHERE route_id=$1', [id, t.to]);
    await bump(c, id);
    return finishVersioned(c, user, id, beforeSnap, t.action, t.text);
  });
}

/** Discard a draft (re-record). Published/inactive routes can never be deleted. */
async function discardDraft(user, id) {
  return withTransaction(async (c) => {
    const { rows } = await c.query(`SELECT status FROM routes WHERE route_id=$1 FOR UPDATE`, [id]);
    if (!rows[0]) throw notFound('Route');
    if (rows[0].status !== 'draft') throw conflict('Only drafts can be discarded; deactivate published routes instead', undefined, 'NOT_A_DRAFT');
    const snap = await snapshot(c, id);
    await c.query('DELETE FROM routes WHERE route_id=$1', [id]); // cascades points, waypoints, draft versions
    await writeAudit(c, { userId: user.id, action: 'route.discard_draft', entityType: 'route', entityId: id, previous: snap });
    return { routeId: id, discarded: true };
  });
}

/** Super Admin: restore metadata + geometry + waypoints together, as a new version. */
async function restore(user, id, versionNumber, expected) {
  return withTransaction(async (c) => {
    const before = await lockAndCheck(c, id, expected);
    const { rows } = await c.query('SELECT snapshot_data FROM route_versions WHERE route_id=$1 AND version_number=$2', [id, versionNumber]);
    if (!rows[0]) throw notFound(`Version ${versionNumber} of this route`);
    const s = rows[0].snapshot_data;
    if (s.status !== 'draft' && (s.points || []).length < 2) throw badRequest('That snapshot has fewer than 2 points and cannot be restored as a published route');
    const beforeSnap = await snapshot(c, id);
    await c.query(
      `UPDATE routes SET source_location_id=$2, destination_location_id=$3, route_name=$4, directionality=$5,
              has_stairs=$6, has_ramp=$7, is_covered=$8, notes=$9, status=$10 WHERE route_id=$1`,
      [id, s.sourceLocationId, s.destinationLocationId, s.routeName, s.directionality, s.hasStairs ?? null, s.hasRamp ?? null, s.isCovered ?? null, s.notes ?? null, s.status]);
    await replacePoints(c, id, s.points || []);
    await replaceWaypoints(c, id, (s.waypoints || []).map((w) => w.locationId));
    await bump(c, id);
    void before;
    return finishVersioned(c, user, id, beforeSnap, 'route.restore', `Restored from version ${versionNumber}`);
  });
}

/* ---------- history ---------- */
async function history(id, limit, offset) {
  const ex = await query('SELECT 1 FROM routes WHERE route_id=$1', [id]);
  if (!ex.rows[0]) throw notFound('Route');
  const [{ rows }, { rows: c }] = await Promise.all([
    query(`SELECT v.version_number, v.modified_at, v.change_description, v.modified_by, u.name AS modified_by_name
             FROM route_versions v LEFT JOIN users u ON u.user_id = v.modified_by
            WHERE v.route_id=$1 ORDER BY v.version_number DESC LIMIT $2 OFFSET $3`, [id, limit, offset]),
    query('SELECT count(*) AS n FROM route_versions WHERE route_id=$1', [id]),
  ]);
  return { total: c[0].n, limit, offset, items: rows.map((r) => ({ versionNumber: r.version_number, modifiedAt: r.modified_at,
    changeDescription: r.change_description, modifiedBy: r.modified_by, modifiedByName: r.modified_by_name })) };
}
async function getVersion(id, n) {
  const { rows } = await query('SELECT version_number, snapshot_data, modified_at, change_description FROM route_versions WHERE route_id=$1 AND version_number=$2', [id, n]);
  if (!rows[0]) throw notFound(`Version ${n}`);
  return { versionNumber: rows[0].version_number, modifiedAt: rows[0].modified_at, changeDescription: rows[0].change_description, snapshot: rows[0].snapshot_data };
}
async function compare(id, a, b) {
  if (a === b) throw badRequest('Choose two different versions to compare');
  const [va, vb] = await Promise.all([getVersion(id, a), getVersion(id, b)]);
  return { from: a, to: b, changes: diffSnapshots(va.snapshot, vb.snapshot) };
}

module.exports = { publishedForOffline, alternatives, listAdmin, getAdmin, createDraft, appendPoints, update, changeStatus, discardDraft, restore, history, getVersion, compare };
