/**
 * Idempotent seed script for SMVITM Campus Navigation System.
 * Creates 6 realistic campus buildings and 3 pedestrian routes with waypoints/metadata.
 *
 * Usage:
 *   node scripts/seed-smvitm.js
 *
 * Notes:
 * - Coordinates are approximate campus-area coordinates for SMVITM, Bantakal, Udupi.
 *   They should be verified/refined with on-site GPS recording for production accuracy.
 * - Route geometries are interpolated pedestrian paths and should be replaced with
 *   recorded GPS tracks from the Admin Recorder when available.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const { withTransaction, close } = require('../src/db');

const BUILDINGS = [
  {
    name: 'Main Academic Block',
    description: 'Central academic and administrative block at SMVITM with classrooms, faculty offices, seminar spaces, and administrative services. Facilities: classrooms, offices, washrooms, drinking water.',
    latitude: 13.2548,
    longitude: 74.7852,
  },
  {
    name: 'Central Library',
    description: 'SMVITM central library providing books, journals, digital resources, and reading areas for students and staff. Facilities: reading hall, reference section, Wi-Fi, study tables.',
    latitude: 13.2553,
    longitude: 74.7858,
  },
  {
    name: 'Canteen',
    description: 'Campus canteen serving meals, snacks, and beverages during college hours. Facilities: seating area, food counters, drinking water.',
    latitude: 13.2542,
    longitude: 74.7847,
  },
  {
    name: 'Computer Science & Engineering Block',
    description: 'Department block for Computer Science and allied programs with labs and faculty rooms. Facilities: computer labs, classrooms, project lab, faculty cabins.',
    latitude: 13.2559,
    longitude: 74.7862,
  },
  {
    name: 'Administrative Office Block',
    description: 'Administrative offices supporting admissions, accounts, student services, and management functions. Facilities: reception, accounts, student support, records.',
    latitude: 13.2546,
    longitude: 74.7860,
  },
  {
    name: 'Sports & Activity Area',
    description: 'Open sports and student activity area used for outdoor games and campus events. Facilities: play area, open grounds, seating nearby.',
    latitude: 13.2538,
    longitude: 74.7842,
  },
];

function lerp(a, b, t) { return a + (b - a) * t; }
function interpolatePath(start, end, steps = 20, curve = 0) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lat = lerp(start.latitude, end.latitude, t);
    const lng = lerp(start.longitude, end.longitude, t) + Math.sin(t * Math.PI) * curve;
    pts.push({ latitude: Number(lat.toFixed(7)), longitude: Number(lng.toFixed(7)) });
  }
  return pts;
}
function concatPaths(...parts) {
  const out = [];
  for (const p of parts) {
    if (!p.length) continue;
    if (out.length) out.push(...p.slice(1)); else out.push(...p);
  }
  return out;
}

const ROUTES = [
  {
    name: 'Main Block to Central Library Walkway',
    source: 'Main Academic Block',
    destination: 'Central Library',
    directionality: 'bidirectional',
    hasStairs: false,
    hasRamp: true,
    isCovered: true,
    notes: 'Primary pedestrian walkway connecting the academic block and library. Accessibility metadata should be field-verified.',
    waypointNames: [],
    points: ({ src, dst }) => interpolatePath(src, dst, 24, 0.00006),
  },
  {
    name: 'Main Block to Canteen Path',
    source: 'Main Academic Block',
    destination: 'Canteen',
    directionality: 'one_way',
    hasStairs: null,
    hasRamp: null,
    isCovered: false,
    notes: 'Outdoor pedestrian path to the canteen. Use with caution during rain; verify conditions on-site.',
    waypointNames: [],
    points: ({ src, dst }) => interpolatePath(src, dst, 20, -0.00004),
  },
  {
    name: 'Library to CSE Block via Admin Office',
    source: 'Central Library',
    destination: 'Computer Science & Engineering Block',
    directionality: 'one_way',
    hasStairs: false,
    hasRamp: null,
    isCovered: false,
    notes: 'Pedestrian route passing near the Administrative Office Block.',
    waypointNames: ['Administrative Office Block'],
    points: ({ src, via, dst }) => concatPaths(
      interpolatePath(src, via[0], 14, 0.00003),
      interpolatePath(via[0], dst, 14, -0.00003),
    ),
  },
];

async function ensureSuperAdmin(client) {
  const email = (config.superAdminEmail || 'admin@smvitm.ac.in').toLowerCase();
  const { rows } = await client.query('SELECT user_id FROM users WHERE email=$1', [email]);
  if (rows[0]) return rows[0].user_id;
  const hash = await bcrypt.hash('SMVITMAdmin@2024', 12);
  const ins = await client.query(
    `INSERT INTO users (name, email, password_hash, role_id, account_status, force_password_change)
     VALUES ($1,$2,$3,(SELECT role_id FROM roles WHERE role_name='super_admin'),'active', false)
     RETURNING user_id`,
    ['SMVITM Super Admin', email, hash]
  );
  return ins.rows[0].user_id;
}

async function upsertLocation(client, b, userId) {
  const existing = await client.query(
    'SELECT location_id, version_number FROM locations WHERE lower(btrim(name)) = lower($1)',
    [b.name]
  );
  if (existing.rows[0]) {
    const id = existing.rows[0].location_id;
    const before = await client.query('SELECT * FROM locations WHERE location_id=$1 FOR UPDATE', [id]);
    const cur = before.rows[0];
    await client.query(
      `UPDATE locations SET description=$2, latitude=$3, longitude=$4, status='active',
              version_number=version_number+1, updated_at=now() WHERE location_id=$1`,
      [id, b.description, b.latitude, b.longitude]
    );
    const after = await client.query('SELECT * FROM locations WHERE location_id=$1', [id]);
    const snap = {
      locationId: id, name: after.rows[0].name, description: after.rows[0].description,
      latitude: after.rows[0].latitude, longitude: after.rows[0].longitude,
      imageUrl: after.rows[0].image_url, status: after.rows[0].status,
    };
    await client.query(
      `INSERT INTO location_versions (location_id, version_number, snapshot_data, modified_by, change_description)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, after.rows[0].version_number, JSON.stringify(snap), userId, 'Seed upsert']
    );
    return id;
  }

  const ins = await client.query(
    `INSERT INTO locations (name, description, latitude, longitude, status)
     VALUES ($1,$2,$3,$4,'active') RETURNING location_id, version_number, image_url`,
    [b.name, b.description, b.latitude, b.longitude]
  );
  const loc = ins.rows[0];
  const snap = {
    locationId: loc.location_id, name: b.name, description: b.description,
    latitude: b.latitude, longitude: b.longitude, imageUrl: loc.image_url, status: 'active',
  };
  await client.query(
    `INSERT INTO location_versions (location_id, version_number, snapshot_data, modified_by, change_description)
     VALUES ($1,$2,$3,$4,$5)`,
    [loc.location_id, loc.version_number, JSON.stringify(snap), userId, 'Initial seed']
  );
  return loc.location_id;
}

async function upsertRoute(client, spec, ids, userId) {
  const srcId = ids[spec.source];
  const dstId = ids[spec.destination];
  const waypointIds = (spec.waypointNames || []).map((n) => ids[n]).filter(Boolean);
  const src = BUILDINGS.find((b) => b.name === spec.source);
  const dst = BUILDINGS.find((b) => b.name === spec.destination);
  const via = (spec.waypointNames || []).map((n) => BUILDINGS.find((b) => b.name === n)).filter(Boolean);
  const points = spec.points({ src, dst, via });

  const ex = await client.query('SELECT route_id FROM routes WHERE lower(btrim(route_name))=lower($1)', [spec.name]);
  let routeId;
  if (ex.rows[0]) {
    routeId = ex.rows[0].route_id;
    await client.query(
      `UPDATE routes SET source_location_id=$2, destination_location_id=$3, route_name=$4, directionality=$5,
              has_stairs=$6, has_ramp=$7, is_covered=$8, notes=$9, status='active',
              version_number=version_number+1, updated_at=now()
       WHERE route_id=$1`,
      [routeId, srcId, dstId, spec.name, spec.directionality, spec.hasStairs, spec.hasRamp, spec.isCovered, spec.notes || null]
    );
  } else {
    const ins = await client.query(
      `INSERT INTO routes (source_location_id, destination_location_id, route_name, directionality, has_stairs, has_ramp, is_covered, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9) RETURNING route_id`,
      [srcId, dstId, spec.name, spec.directionality, spec.hasStairs, spec.hasRamp, spec.isCovered, spec.notes || null, userId]
    );
    routeId = ins.rows[0].route_id;
  }

  await client.query('DELETE FROM route_points WHERE route_id=$1', [routeId]);
  await client.query('DELETE FROM route_waypoints WHERE route_id=$1', [routeId]);
  if (points.length) {
    await client.query(
      `INSERT INTO route_points (route_id, sequence_number, latitude, longitude)
       SELECT $1, ord, lat, lng
       FROM unnest($2::int[], $3::float8[], $4::float8[]) AS t(ord, lat, lng)`,
      [routeId, points.map((_, i) => i + 1), points.map((p) => p.latitude), points.map((p) => p.longitude)]
    );
  }
  if (waypointIds.length) {
    await client.query(
      `INSERT INTO route_waypoints (route_id, location_id, sequence_number)
       SELECT $1, loc, ord FROM unnest($2::bigint[]) WITH ORDINALITY AS t(loc, ord)`,
      [routeId, waypointIds]
    );
  }

  const v = (await client.query('SELECT version_number FROM routes WHERE route_id=$1', [routeId])).rows[0].version_number;
  const snap = {
    routeId, sourceLocationId: srcId, destinationLocationId: dstId, routeName: spec.name,
    directionality: spec.directionality, hasStairs: spec.hasStairs, hasRamp: spec.hasRamp,
    isCovered: spec.isCovered, notes: spec.notes || null, status: 'active',
    points: points.map((p, i) => ({ sequenceNumber: i + 1, latitude: p.latitude, longitude: p.longitude })),
    waypoints: waypointIds.map((id, i) => ({ sequenceNumber: i + 1, locationId: id })),
  };
  await client.query(
    `INSERT INTO route_versions (route_id, version_number, snapshot_data, modified_by, change_description)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (route_id, version_number) DO UPDATE SET snapshot_data=EXCLUDED.snapshot_data, modified_by=EXCLUDED.modified_by, change_description=EXCLUDED.change_description`,
    [routeId, v, JSON.stringify(snap), userId, ex.rows[0] ? 'Seed upsert' : 'Initial seed']
  );
  return routeId;
}

(async () => {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
  console.log('Seeding SMVITM campus data (idempotent)...');
  await withTransaction(async (client) => {
    const userId = await ensureSuperAdmin(client);
    const ids = {};
    for (const b of BUILDINGS) {
      ids[b.name] = await upsertLocation(client, b, userId);
      console.log(`  location: ${b.name} (${ids[b.name]})`);
    }
    for (const r of ROUTES) {
      const id = await upsertRoute(client, r, ids, userId);
      console.log(`  route: ${r.name} (${id})`);
    }
  });
  console.log('Seed complete.');
  console.log(`Admin login: ${(config.superAdminEmail || 'admin@smvitm.ac.in')} / SMVITMAdmin@2024 (if created by this seed)`);
})().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exitCode = 1;
}).finally(() => close());
