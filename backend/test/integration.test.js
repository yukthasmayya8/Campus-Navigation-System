/**
 * Backend integration tests – require a real PostgreSQL+PostGIS database.
 *
 * Usage:
 *   TEST_DATABASE_URL=postgresql://... node --test test/integration.test.js
 *
 * The tests run against an ISOLATED test database. Each test suite uses a
 * transaction that is rolled back so tests are hermetic and order-independent.
 *
 * Required env vars:
 *   TEST_DATABASE_URL  – e.g. postgresql://postgres:postgres@localhost:5432/campus_nav_test
 *   JWT_SECRET         – same as your .env (or set here)
 */
'use strict';
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');

// ── Patch DATABASE_URL with the test database ────────────────────────────────
const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) {
  console.error('⚠  Set TEST_DATABASE_URL to run integration tests. Skipping.');
  process.exit(0);
}
process.env.DATABASE_URL = TEST_DB;

// Lazy-require AFTER patching the env so the pool connects to the test DB.
const { getPool, withTransaction, close } = require('../src/db');
const { createApp } = require('../src/app');
const http = require('node:http');

// ── Minimal HTTP helper ──────────────────────────────────────────────────────
let server, baseUrl;
const app = createApp();

async function startServer() {
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}
async function stopServer() {
  if (server) await new Promise((resolve) => server.close(resolve));
  await close();
}

async function req(method, path, { body, cookie } = {}) {
  const url = new URL(`/api${path}`, baseUrl);
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data, headers: res.headers };
}

// ── Seed helpers (direct DB, bypass HTTP so tests are fast) ──────────────────
const bcrypt = require('bcryptjs');

async function seedUser(client, { name, email, password, role = 'admin' }) {
  const hash = await bcrypt.hash(password, 4); // fast for tests
  const { rows } = await client.query(
    `INSERT INTO users (name, email, password_hash, role_id, force_password_change)
     VALUES ($1,$2,$3,(SELECT role_id FROM roles WHERE role_name=$4),false)
     RETURNING user_id`,
    [name, email, hash, role],
  );
  return rows[0].user_id;
}

async function seedLocation(client, userId, { name, lat, lng }) {
  const { rows } = await client.query(
    `INSERT INTO locations (name, description, latitude, longitude)
     VALUES ($1,'',$2,$3) RETURNING location_id`,
    [name, lat, lng],
  );
  await client.query(
    `INSERT INTO location_versions (location_id, version_number, snapshot_data, modified_by, change_description)
     VALUES ($1,1,$2,$3,'test seed')`,
    [rows[0].location_id, JSON.stringify({ name, latitude: lat, longitude: lng, status: 'active' }), userId],
  );
  return rows[0].location_id;
}

// ── Schema bootstrap (applied once before all tests) ─────────────────────────
test.before(async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
  await startServer();
  console.log('  ✓ Test schema applied, server at', baseUrl);
});

test.after(async () => { await stopServer(); });

// ── Helper: login and get cookie ──────────────────────────────────────────────
async function loginCookie(email, password) {
  const r = await req('POST', '/auth/login', { body: { email, password } });
  assert.strictEqual(r.status, 200, `Login failed: ${JSON.stringify(r.data)}`);
  const setCookie = r.headers.get('set-cookie');
  assert.ok(setCookie, 'No Set-Cookie header on login');
  return setCookie.split(';')[0]; // just the name=value part
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Auth
// ═══════════════════════════════════════════════════════════════════════════
test('POST /auth/login – happy path sets cookie, returns user object', async (t) => {
  await withTransaction(async (client) => {
    await seedUser(client, { name: 'Auth Tester', email: 'auth@test.local', password: 'Password123', role: 'admin' });
    const r = await req('POST', '/auth/login', { body: { email: 'auth@test.local', password: 'Password123' } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.user.userId, 'userId missing');
    assert.ok(r.headers.get('set-cookie'), 'Cookie not set');
    throw Object.assign(new Error('rollback'), { code: 'TEST_ROLLBACK' }); // force rollback
  }).catch((e) => { if (e.message !== 'rollback') throw e; });
});

test('POST /auth/login – wrong password returns 401', async () => {
  await withTransaction(async (client) => {
    await seedUser(client, { name: 'Auth2', email: 'auth2@test.local', password: 'RightPass1', role: 'admin' });
    const r = await req('POST', '/auth/login', { body: { email: 'auth2@test.local', password: 'WrongPass1' } });
    assert.strictEqual(r.status, 401);
    throw Object.assign(new Error('rollback'), { code: 'TEST_ROLLBACK' });
  }).catch((e) => { if (e.message !== 'rollback') throw e; });
});

test('GET /auth/me – returns 401 without cookie', async () => {
  const r = await req('GET', '/auth/me');
  assert.strictEqual(r.status, 401);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Locations
// ═══════════════════════════════════════════════════════════════════════════
test('POST /admin/locations – creates location, returns 201 with locationId', async () => {
  // Need a user and cookie first (outside transaction for HTTP test)
  const pool = getPool(); const c = await pool.connect();
  let userId, cookie;
  try {
    await c.query('BEGIN');
    userId = await seedUser(c, { name: 'LocAdmin', email: 'locadmin@test.local', password: 'LocAdmin123', role: 'admin' });
    await c.query('COMMIT');
  } finally { c.release(); }

  cookie = await loginCookie('locadmin@test.local', 'LocAdmin123');
  const r = await req('POST', '/admin/locations', {
    cookie,
    body: { name: 'Integration Test Building', description: 'Test', latitude: 13.3300, longitude: 74.7900 },
  });
  assert.strictEqual(r.status, 201, JSON.stringify(r.data));
  assert.ok(r.data.locationId, 'locationId missing');

  // Cleanup
  const c2 = await pool.connect();
  try {
    await c2.query('DELETE FROM locations WHERE name=$1', ['Integration Test Building']);
    await c2.query('DELETE FROM users WHERE user_id=$1', [userId]);
  } finally { c2.release(); }
});

test('POST /admin/locations – 409 when another location is nearby', async () => {
  const pool = getPool(); const c = await pool.connect();
  let userId, locId;
  try {
    await c.query('BEGIN');
    userId = await seedUser(c, { name: 'NearAdmin', email: 'nearadmin@test.local', password: 'Near1Admin', role: 'admin' });
    locId = await seedLocation(c, userId, { name: 'Near Loc Existing', lat: 13.3400, lng: 74.7950 });
    await c.query('COMMIT');
  } finally { c.release(); }

  const cookie = await loginCookie('nearadmin@test.local', 'Near1Admin');
  // Try to create another location 5 m away (within 15 m radius)
  const r = await req('POST', '/admin/locations', {
    cookie,
    body: { name: 'Near Loc Duplicate', description: '', latitude: 13.34001, longitude: 74.79501 },
  });
  assert.strictEqual(r.status, 409, `Expected 409, got ${r.status}: ${JSON.stringify(r.data)}`);
  assert.strictEqual(r.data.error.code, 'NEARBY_LOCATION');

  // Cleanup
  const c2 = await pool.connect();
  try {
    await c2.query('DELETE FROM route_waypoints WHERE location_id=$1', [locId]);
    await c2.query('DELETE FROM route_points WHERE route_id IN (SELECT route_id FROM routes WHERE source_location_id=$1 OR destination_location_id=$1)', [locId]);
    await c2.query('DELETE FROM routes WHERE source_location_id=$1 OR destination_location_id=$1', [locId]);
    await c2.query('DELETE FROM location_versions WHERE location_id=$1', [locId]);
    await c2.query('DELETE FROM locations WHERE location_id=$1', [locId]);
    await c2.query('DELETE FROM users WHERE user_id=$1', [userId]);
  } finally { c2.release(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Routes – draft → points → publish → GET public
// ═══════════════════════════════════════════════════════════════════════════
test('Route lifecycle: create draft → append points → publish → GET /routes', async () => {
  const pool = getPool(); const c = await pool.connect();
  let userId, srcId, dstId, routeId;
  try {
    await c.query('BEGIN');
    userId = await seedUser(c, { name: 'RouteAdmin', email: 'routeadmin@test.local', password: 'Route1Admin', role: 'admin' });
    srcId = await seedLocation(c, userId, { name: 'Route Test Src', lat: 13.3350, lng: 74.7870 });
    dstId = await seedLocation(c, userId, { name: 'Route Test Dst', lat: 13.3360, lng: 74.7880 });
    await c.query('COMMIT');
  } finally { c.release(); }

  const cookie = await loginCookie('routeadmin@test.local', 'Route1Admin');

  // 1. Create draft
  const draftRes = await req('POST', '/admin/routes', {
    cookie,
    body: { sourceLocationId: srcId, destinationLocationId: dstId, routeName: 'Integration Test Route',
      directionality: 'bidirectional', waypointLocationIds: [] },
  });
  assert.strictEqual(draftRes.status, 201, JSON.stringify(draftRes.data));
  routeId = draftRes.data.routeId;
  let version = draftRes.data.versionNumber;
  assert.strictEqual(draftRes.data.status, 'draft');

  // 2. Append points
  const points = [
    { sequenceNumber: 1, latitude: 13.3350, longitude: 74.7870 },
    { sequenceNumber: 2, latitude: 13.3355, longitude: 74.7875 },
    { sequenceNumber: 3, latitude: 13.3360, longitude: 74.7880 },
  ];
  const ptsRes = await req('POST', `/admin/routes/${routeId}/points`, { cookie, body: { points } });
  assert.strictEqual(ptsRes.status, 200, JSON.stringify(ptsRes.data));
  assert.strictEqual(ptsRes.data.inserted, 3);

  // 3. Publish
  const pubRes = await req('POST', `/admin/routes/${routeId}/publish`, { cookie, body: { expectedVersion: version } });
  assert.strictEqual(pubRes.status, 200, JSON.stringify(pubRes.data));
  assert.strictEqual(pubRes.data.status, 'active');
  version = pubRes.data.versionNumber;

  // 4. GET public /routes
  const getRes = await req('GET', `/routes?from=${srcId}&to=${dstId}`);
  assert.strictEqual(getRes.status, 200);
  assert.ok(getRes.data.items.length > 0, 'No routes returned after publishing');
  assert.strictEqual(getRes.data.items[0].routeId, routeId);

  // Cleanup
  const c2 = await pool.connect();
  try {
    await c2.query('DELETE FROM route_waypoints WHERE route_id=$1', [routeId]);
    await c2.query('DELETE FROM route_points WHERE route_id=$1', [routeId]);
    await c2.query('DELETE FROM route_versions WHERE route_id=$1', [routeId]);
    await c2.query('DELETE FROM audit_logs WHERE entity_id=$1 AND entity_type=\'route\'', [routeId]);
    await c2.query('DELETE FROM routes WHERE route_id=$1', [routeId]);
    for (const id of [srcId, dstId]) {
      await c2.query('DELETE FROM location_versions WHERE location_id=$1', [id]);
      await c2.query('DELETE FROM locations WHERE location_id=$1', [id]);
    }
    await c2.query('DELETE FROM users WHERE user_id=$1', [userId]);
  } finally { c2.release(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Stale-version 409
// ═══════════════════════════════════════════════════════════════════════════
test('PUT /admin/routes/:id with wrong expectedVersion returns 409', async () => {
  const pool = getPool(); const c = await pool.connect();
  let userId, srcId, dstId, routeId;
  try {
    await c.query('BEGIN');
    userId = await seedUser(c, { name: 'StaleAdmin', email: 'staleadmin@test.local', password: 'Stale1Admin', role: 'admin' });
    srcId = await seedLocation(c, userId, { name: 'Stale Test Src', lat: 13.3370, lng: 74.7890 });
    dstId = await seedLocation(c, userId, { name: 'Stale Test Dst', lat: 13.3375, lng: 74.7895 });
    await c.query('COMMIT');
  } finally { c.release(); }

  const cookie = await loginCookie('staleadmin@test.local', 'Stale1Admin');

  const draftRes = await req('POST', '/admin/routes', {
    cookie,
    body: { sourceLocationId: srcId, destinationLocationId: dstId, routeName: 'Stale Version Test',
      directionality: 'one_way', waypointLocationIds: [] },
  });
  routeId = draftRes.data.routeId;
  const correctVersion = draftRes.data.versionNumber;

  // Send wrong version
  const updateRes = await req('PUT', `/admin/routes/${routeId}`, {
    cookie,
    body: { routeName: 'Updated Name', expectedVersion: correctVersion + 99 },
  });
  assert.strictEqual(updateRes.status, 409, `Expected 409, got ${updateRes.status}`);
  assert.strictEqual(updateRes.data.error.code, 'VERSION_CONFLICT');

  // Cleanup
  const c2 = await pool.connect();
  try {
    await c2.query('DELETE FROM route_versions WHERE route_id=$1', [routeId]);
    await c2.query('DELETE FROM audit_logs WHERE entity_id=$1 AND entity_type=\'route\'', [routeId]);
    await c2.query('DELETE FROM routes WHERE route_id=$1', [routeId]);
    for (const id of [srcId, dstId]) {
      await c2.query('DELETE FROM location_versions WHERE location_id=$1', [id]);
      await c2.query('DELETE FROM locations WHERE location_id=$1', [id]);
    }
    await c2.query('DELETE FROM users WHERE user_id=$1', [userId]);
  } finally { c2.release(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Super Admin restore
// ═══════════════════════════════════════════════════════════════════════════
test('POST /admin/routes/:id/restore – Super Admin can restore a previous version', async () => {
  const pool = getPool(); const c = await pool.connect();
  let userId, srcId, dstId, routeId;
  try {
    await c.query('BEGIN');
    userId = await seedUser(c, { name: 'SAAdmin', email: 'saadmin@test.local', password: 'SA1Admin12', role: 'super_admin' });
    srcId = await seedLocation(c, userId, { name: 'SA Test Src', lat: 13.3380, lng: 74.7900 });
    dstId = await seedLocation(c, userId, { name: 'SA Test Dst', lat: 13.3385, lng: 74.7905 });
    await c.query('COMMIT');
  } finally { c.release(); }

  const cookie = await loginCookie('saadmin@test.local', 'SA1Admin12');

  // Create draft (version 1)
  const draftRes = await req('POST', '/admin/routes', {
    cookie,
    body: { sourceLocationId: srcId, destinationLocationId: dstId, routeName: 'Restore Test V1',
      directionality: 'one_way', waypointLocationIds: [] },
  });
  routeId = draftRes.data.routeId;
  let version = draftRes.data.versionNumber; // 1

  // Update (version 2)
  const updRes = await req('PUT', `/admin/routes/${routeId}`, {
    cookie,
    body: { routeName: 'Restore Test V2', expectedVersion: version },
  });
  assert.strictEqual(updRes.status, 200, JSON.stringify(updRes.data));
  version = updRes.data.versionNumber; // 2

  // Restore to version 1
  const restRes = await req('POST', `/admin/routes/${routeId}/restore`, {
    cookie,
    body: { versionNumber: 1, expectedVersion: version },
  });
  assert.strictEqual(restRes.status, 200, JSON.stringify(restRes.data));
  assert.strictEqual(restRes.data.routeName, 'Restore Test V1', 'Route name not restored');

  // Cleanup
  const c2 = await pool.connect();
  try {
    await c2.query('DELETE FROM route_versions WHERE route_id=$1', [routeId]);
    await c2.query('DELETE FROM audit_logs WHERE entity_id=$1 AND entity_type=\'route\'', [routeId]);
    await c2.query('DELETE FROM routes WHERE route_id=$1', [routeId]);
    for (const id of [srcId, dstId]) {
      await c2.query('DELETE FROM location_versions WHERE location_id=$1', [id]);
      await c2.query('DELETE FROM locations WHERE location_id=$1', [id]);
    }
    await c2.query('DELETE FROM users WHERE user_id=$1', [userId]);
  } finally { c2.release(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Regular admin cannot restore (403)
// ═══════════════════════════════════════════════════════════════════════════
test('POST /admin/routes/:id/restore – regular admin gets 403', async () => {
  const pool = getPool(); const c = await pool.connect();
  let userId, srcId, dstId, routeId;
  try {
    await c.query('BEGIN');
    userId = await seedUser(c, { name: 'NoRestore', email: 'norestore@test.local', password: 'NoRest1ore', role: 'admin' });
    srcId = await seedLocation(c, userId, { name: 'NoRest Src', lat: 13.3390, lng: 74.7910 });
    dstId = await seedLocation(c, userId, { name: 'NoRest Dst', lat: 13.3395, lng: 74.7915 });
    await c.query('COMMIT');
  } finally { c.release(); }

  const cookie = await loginCookie('norestore@test.local', 'NoRest1ore');

  const draftRes = await req('POST', '/admin/routes', {
    cookie,
    body: { sourceLocationId: srcId, destinationLocationId: dstId, routeName: 'NoRestore Route',
      directionality: 'one_way', waypointLocationIds: [] },
  });
  routeId = draftRes.data.routeId;

  const restRes = await req('POST', `/admin/routes/${routeId}/restore`, {
    cookie,
    body: { versionNumber: 1, expectedVersion: draftRes.data.versionNumber },
  });
  assert.strictEqual(restRes.status, 403);

  // Cleanup
  const c2 = await pool.connect();
  try {
    await c2.query('DELETE FROM route_versions WHERE route_id=$1', [routeId]);
    await c2.query('DELETE FROM audit_logs WHERE entity_id=$1 AND entity_type=\'route\'', [routeId]);
    await c2.query('DELETE FROM routes WHERE route_id=$1', [routeId]);
    for (const id of [srcId, dstId]) {
      await c2.query('DELETE FROM location_versions WHERE location_id=$1', [id]);
      await c2.query('DELETE FROM locations WHERE location_id=$1', [id]);
    }
    await c2.query('DELETE FROM users WHERE user_id=$1', [userId]);
  } finally { c2.release(); }
});
