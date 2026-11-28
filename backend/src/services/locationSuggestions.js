const { query, withTransaction } = require('../db');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { writeAudit, writeLocationVersion } = require('./audit');

const COLS = `suggestion_id, name, description, category, latitude, longitude, accuracy, status,
  submitted_at, reviewed_by, reviewed_at, review_notes, approved_location_id`;

const toSuggestion = (r) => ({
  suggestionId: r.suggestion_id,
  name: r.name,
  description: r.description,
  category: r.category,
  latitude: r.latitude,
  longitude: r.longitude,
  accuracy: r.accuracy,
  status: r.status,
  submittedAt: r.submitted_at,
  reviewedBy: r.reviewed_by,
  reviewedAt: r.reviewed_at,
  reviewNotes: r.review_notes,
  approvedLocationId: r.approved_location_id,
});

async function create(data) {
  const { rows } = await query(
    `INSERT INTO location_suggestions (name, description, category, latitude, longitude, accuracy)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLS}`,
    [data.name, data.description || '', data.category || 'Other', data.latitude, data.longitude, data.accuracy ?? null]);
  return toSuggestion(rows[0]);
}

async function list({ status, limit = 20, offset = 0 } = {}) {
  const params = [];
  const where = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  params.push(limit, offset);
  const { rows } = await query(
    `SELECT ${COLS} FROM location_suggestions ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY submitted_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const { rows: cnt } = await query(
    `SELECT count(*)::int AS n FROM location_suggestions ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
    status ? [status] : []);
  return { total: cnt[0].n, items: rows.map(toSuggestion) };
}

async function get(id) {
  const { rows } = await query(`SELECT ${COLS} FROM location_suggestions WHERE suggestion_id=$1`, [id]);
  if (!rows[0]) throw notFound('Location suggestion');
  return toSuggestion(rows[0]);
}

async function lock(c, id) {
  const { rows } = await c.query(`SELECT ${COLS} FROM location_suggestions WHERE suggestion_id=$1 FOR UPDATE`, [id]);
  if (!rows[0]) throw notFound('Location suggestion');
  return rows[0];
}

async function update(user, id, data) {
  return withTransaction(async (c) => {
    const before = await lock(c, id);
    if (before.status !== 'pending') throw conflict('Only pending suggestions can be edited', undefined, 'NOT_PENDING');
    const next = {
      name: data.name ?? before.name,
      description: data.description ?? before.description,
      category: data.category ?? before.category,
      latitude: data.latitude ?? before.latitude,
      longitude: data.longitude ?? before.longitude,
      accuracy: data.accuracy !== undefined ? data.accuracy : before.accuracy,
    };
    const { rows } = await c.query(
      `UPDATE location_suggestions SET name=$2, description=$3, category=$4, latitude=$5, longitude=$6, accuracy=$7
       WHERE suggestion_id=$1 RETURNING ${COLS}`,
      [id, next.name, next.description, next.category, next.latitude, next.longitude, next.accuracy]);
    await writeAudit(c, { userId: user.id, action: 'location_suggestion.update', entityType: 'location_suggestion', entityId: id, previous: toSuggestion(before), next: toSuggestion(rows[0]) });
    return toSuggestion(rows[0]);
  });
}

async function approve(user, id, { confirmNearby = false } = {}) {
  return withTransaction(async (c) => {
    const suggestion = await lock(c, id);
    if (suggestion.status !== 'pending') throw conflict('Only pending suggestions can be approved', undefined, 'NOT_PENDING');

    // Duplicate check against active locations.
    const { rows: nearbyRows } = await c.query(
      `SELECT location_id, name, round(ST_Distance(geom, p.g)::numeric, 1)::float AS distance_m
         FROM locations, (SELECT ST_SetSRID(ST_MakePoint($2,$1),4326)::geography AS g) p
        WHERE status='active' AND ST_DWithin(geom, p.g, $3) ORDER BY distance_m LIMIT 5`,
      [suggestion.latitude, suggestion.longitude, 15]);
    if (nearbyRows.length && !confirmNearby) {
      throw conflict('An active location is nearby. Confirm to approve anyway.', { nearby: nearbyRows.map((r) => ({ locationId: r.location_id, name: r.name, distanceMeters: r.distance_m })) }, 'NEARBY_LOCATION');
    }

    const { rows } = await c.query(
      `INSERT INTO locations (name, description, latitude, longitude, image_url)
       VALUES ($1,$2,$3,$4,$5) RETURNING location_id, name, description, latitude, longitude, image_url, status, version_number, created_at, updated_at`,
      [suggestion.name, suggestion.description || '', suggestion.latitude, suggestion.longitude, null]);
    const location = rows[0];
    const snap = { locationId: location.location_id, name: location.name, description: location.description, latitude: location.latitude, longitude: location.longitude, imageUrl: location.image_url, status: location.status };
    await writeLocationVersion(c, snap, location.version_number, user.id, 'Location approved from user suggestion');
    await writeAudit(c, { userId: user.id, action: 'location.create', entityType: 'location', entityId: location.location_id, next: snap });

    const { rows: updated } = await c.query(
      `UPDATE location_suggestions SET status='approved', reviewed_by=$2, reviewed_at=now(), approved_location_id=$3
       WHERE suggestion_id=$1 RETURNING ${COLS}`,
      [id, user.id, location.location_id]);
    await writeAudit(c, { userId: user.id, action: 'location_suggestion.approve', entityType: 'location_suggestion', entityId: id, previous: toSuggestion(suggestion), next: toSuggestion(updated[0]) });
    return { suggestion: toSuggestion(updated[0]), location: { locationId: location.location_id, name: location.name, latitude: location.latitude, longitude: location.longitude, status: location.status } };
  });
}

async function reject(user, id, notes = '') {
  return withTransaction(async (c) => {
    const before = await lock(c, id);
    if (before.status !== 'pending') throw conflict('Only pending suggestions can be rejected', undefined, 'NOT_PENDING');
    const { rows } = await c.query(
      `UPDATE location_suggestions SET status='rejected', reviewed_by=$2, reviewed_at=now(), review_notes=$3
       WHERE suggestion_id=$1 RETURNING ${COLS}`,
      [id, user.id, notes || null]);
    await writeAudit(c, { userId: user.id, action: 'location_suggestion.reject', entityType: 'location_suggestion', entityId: id, previous: toSuggestion(before), next: toSuggestion(rows[0]) });
    return toSuggestion(rows[0]);
  });
}

module.exports = { create, list, get, update, approve, reject };