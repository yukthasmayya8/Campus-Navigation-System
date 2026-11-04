/** Shared helpers used inside transactions: audit log + version snapshots. All take a pg client. */

async function writeAudit(client, { userId, action, entityType, entityId, previous = null, next = null }) {
  await client.query(
    `INSERT INTO audit_logs (administrator_id, action, entity_type, entity_id, previous_data, new_data)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId ?? null, action, entityType, entityId ?? null,
     previous === null ? null : JSON.stringify(previous), next === null ? null : JSON.stringify(next)]);
}

async function writeLocationVersion(client, snapshot, versionNumber, userId, description) {
  await client.query(
    `INSERT INTO location_versions (location_id, version_number, snapshot_data, modified_by, change_description)
     VALUES ($1,$2,$3,$4,$5)`, [snapshot.locationId, versionNumber, JSON.stringify(snapshot), userId, description]);
}

async function writeRouteVersion(client, snapshot, versionNumber, userId, description) {
  await client.query(
    `INSERT INTO route_versions (route_id, version_number, snapshot_data, modified_by, change_description)
     VALUES ($1,$2,$3,$4,$5)`, [snapshot.routeId, versionNumber, JSON.stringify(snapshot), userId, description]);
}

module.exports = { writeAudit, writeLocationVersion, writeRouteVersion };
