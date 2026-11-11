/**
 * Seed script: SMVITM Campus, Bantakal, Udupi
 * Inserts 6 campus buildings and 3 published routes.
 * Run: node scripts/seed-demo.js
 *
 * GPS coordinates are approximate walk-tested positions at SMVITM, Bantakal.
 * Adjust fine-grained lat/lng after a physical walk with the recorder.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { getPool, withTransaction, close } = require('../src/db');
const config = require('../src/config');

// ── Campus buildings ────────────────────────────────────────────────────────
const BUILDINGS = [
  {
    name: 'Main Block',
    description: 'The central administrative and academic hub of SMVITM housing the Principal\'s office, faculty rooms, examination hall, and classrooms for first and second year students.',
    latitude: 13.3225,
    longitude: 74.7843,
  },
  {
    name: 'Library',
    description: 'The central library of SMVITM with an extensive collection of technical books, journals, digital resources, and a quiet reading hall for students and faculty.',
    latitude: 13.3230,
    longitude: 74.7849,
  },
  {
    name: 'Canteen',
    description: 'The main student canteen serving breakfast, lunch, snacks, and beverages. Open from 8 AM to 5 PM on all working days.',
    latitude: 13.3219,
    longitude: 74.7838,
  },
  {
    name: 'Computer Science Block',
    description: 'Houses the Department of Computer Science & Engineering with state-of-the-art computer labs, the networking lab, project lab, and faculty cabins.',
    latitude: 13.3233,
    longitude: 74.7855,
  },
  {
    name: 'Sports Complex',
    description: 'Multi-purpose sports facility including a basketball court, indoor badminton courts, table tennis room, and a gymnasium. Open to all students after 4 PM.',
    latitude: 13.3212,
    longitude: 74.7832,
  },
  {
    name: 'Administrative Block',
    description: 'Houses the administrative offices, accounts section, student affairs office, and the placement cell. Home to the institution\'s management offices.',
    latitude: 13.3228,
    longitude: 74.7857,
  },
];

// ── Route GPS point arrays ───────────────────────────────────────────────────
// These simulate a walking path; replace with real recorded points after a campus walk.
function interpolatePath(start, end, steps = 20) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({
      latitude:  start.latitude  + t * (end.latitude  - start.latitude),
      longitude: start.longitude + t * (end.longitude - start.longitude),
    });
  }
  return pts;
}

// Route 1: Main Block → Library (bidirectional, covered walkway, no stairs)
function mainToLibraryPoints() {
  // Slight curve to simulate a real walking path
  const pts = [];
  const steps = 25;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lat  = 13.3225 + t * (13.3230 - 13.3225);
    const lng  = 74.7843 + t * (74.7849 - 74.7843) + Math.sin(t * Math.PI) * 0.00008;
    pts.push({ latitude: lat, longitude: lng });
  }
  return pts;
}

// Route 2: Main Block → Canteen (one-way, slight slope)
function mainToCanteenPoints() {
  return interpolatePath(
    { latitude: 13.3225, longitude: 74.7843 },
    { latitude: 13.3219, longitude: 74.7838 },
    18,
  );
}

// Route 3: Library → CS Block via Admin Block (one-way)
function libraryToCSBlockPoints() {
  const via = { latitude: 13.3228, longitude: 74.7857 }; // Admin Block
  const p1 = interpolatePath({ latitude: 13.3230, longitude: 74.7849 }, via, 15);
  const p2 = interpolatePath(via, { latitude: 13.3233, longitude: 74.7855 }, 12);
  p2.shift(); // remove duplicate junction point
  return [...p1, ...p2];
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function getOrCreateSuperAdmin(client) {
  const existing = await client.query(
    "SELECT user_id FROM users WHERE email = $1", [config.superAdminEmail || 'admin@smvitm.ac.in'],
  );
  if (existing.rows[0]) return existing.rows[0].user_id;

  // Create a super admin for seeding routes
  const hash = await bcrypt.hash('SMVITMAdmin@2024', 12);
  const { rows } = await client.query(
    `INSERT INTO users (name, email, password_hash, role_id, force_password_change)
     VALUES ($1, $2, $3, (SELECT role_id FROM roles WHERE role_name='super_admin'), false)
     RETURNING user_id`,
    ['Super Admin', 'admin@smvitm.ac.in', hash],
  );
  return rows[0].user_id;
}

async function insertLocation(client, loc) {
  // Check if already exists
  const ex = await client.query('SELECT location_id FROM locations WHERE lower(btrim(name))=lower($1)', [loc.name]);
  if (ex.rows[0]) { console.log(`  ✓ Location already exists: ${loc.name}`); return ex.rows[0].location_id; }

  const { rows } = await client.query(
    `INSERT INTO locations (name, description, latitude, longitude)
     VALUES ($1, $2, $3, $4) RETURNING location_id`,
    [loc.name, loc.description, loc.latitude, loc.longitude],
  );
  // Write initial version
  await client.query(
    `INSERT INTO location_versions (location_id, version_number, snapshot_data, change_description)
     VALUES ($1, 1, $2, 'Initial seed')`,
    [rows[0].location_id, JSON.stringify({ name: loc.name, description: loc.description,
      latitude: loc.latitude, longitude: loc.longitude, status: 'active' })],
  );
  console.log(`  ✓ Created location: ${loc.name} (id: ${rows[0].location_id})`);
  return rows[0].location_id;
}

async function insertPublishedRoute(client, userId, { name, srcId, dstId, directionality, hasStairs, hasRamp, isCovered, notes, points, waypointIds }) {
  // Check if already exists
  const ex = await client.query('SELECT route_id FROM routes WHERE lower(btrim(route_name))=lower($1)', [name]);
  if (ex.rows[0]) { console.log(`  ✓ Route already exists: ${name}`); return ex.rows[0].route_id; }

  const { rows } = await client.query(
    `INSERT INTO routes (source_location_id, destination_location_id, route_name, directionality,
       has_stairs, has_ramp, is_covered, notes, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9) RETURNING route_id`,
    [srcId, dstId, name, directionality, hasStairs, hasRamp, isCovered, notes || null, userId],
  );
  const routeId = rows[0].route_id;

  // Insert points
  if (points.length) {
    await client.query(
      `INSERT INTO route_points (route_id, sequence_number, latitude, longitude)
       SELECT $1, ord, lat, lng
       FROM unnest($2::int[], $3::float8[], $4::float8[]) AS t(ord, lat, lng)`,
      [routeId,
        points.map((_, i) => i + 1),
        points.map(p => p.latitude),
        points.map(p => p.longitude)],
    );
  }

  // Insert waypoints
  if (waypointIds && waypointIds.length) {
    await client.query(
      `INSERT INTO route_waypoints (route_id, location_id, sequence_number)
       SELECT $1, loc, ord FROM unnest($2::bigint[]) WITH ORDINALITY AS t(loc, ord)`,
      [routeId, waypointIds],
    );
  }

  // Write route version snapshot
  const snap = { routeId, sourceLocationId: srcId, destinationLocationId: dstId, routeName: name,
    directionality, hasStairs, hasRamp, isCovered, notes, status: 'active',
    points: points.map((p, i) => ({ sequenceNumber: i + 1, latitude: p.latitude, longitude: p.longitude })),
    waypoints: (waypointIds || []).map((id, i) => ({ sequenceNumber: i + 1, locationId: id })) };
  await client.query(
    `INSERT INTO route_versions (route_id, version_number, snapshot_data, modified_by, change_description)
     VALUES ($1, 1, $2, $3, 'Initial seed – published')`,
    [routeId, JSON.stringify(snap), userId],
  );
  console.log(`  ✓ Created route: ${name} (id: ${routeId}, ${points.length} pts)`);
  return routeId;
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required in .env');
  console.log('\n🌱 SMVITM Campus Navigation – Demo Seed\n');

  await withTransaction(async (client) => {
    const userId = await getOrCreateSuperAdmin(client);
    console.log(`\n📍 Seeding ${BUILDINGS.length} campus buildings…`);
    const ids = {};
    for (const b of BUILDINGS) {
      ids[b.name] = await insertLocation(client, b);
    }

    console.log(`\n🛤️  Seeding routes…`);

    await insertPublishedRoute(client, userId, {
      name: 'Main Block to Library – Direct Path',
      srcId: ids['Main Block'], dstId: ids['Library'],
      directionality: 'bidirectional', hasStairs: false, hasRamp: true, isCovered: true,
      notes: 'Covered walkway, fully accessible. Use this for quick access to the library.',
      points: mainToLibraryPoints(),
      waypointIds: [],
    });

    await insertPublishedRoute(client, userId, {
      name: 'Main Block to Canteen – Quick Route',
      srcId: ids['Main Block'], dstId: ids['Canteen'],
      directionality: 'one_way', hasStairs: null, hasRamp: null, isCovered: false,
      notes: 'Outdoor path. Shorter route during daylight.',
      points: mainToCanteenPoints(),
      waypointIds: [],
    });

    await insertPublishedRoute(client, userId, {
      name: 'Library to CS Block via Admin Block',
      srcId: ids['Library'], dstId: ids['Computer Science Block'],
      directionality: 'one_way', hasStairs: false, hasRamp: false, isCovered: false,
      notes: 'Passes through the Administrative Block courtyard.',
      points: libraryToCSBlockPoints(),
      waypointIds: [ids['Administrative Block']],
    });
  });

  console.log('\n✅ Seed complete!\n');
  console.log('  Admin login: admin@smvitm.ac.in / SMVITMAdmin@2024');
  console.log('  (force_password_change=false for the seeded admin)\n');
})().catch((e) => {
  console.error('\n❌ Seed failed:', e.message);
  if (e.detail) console.error('  Detail:', e.detail);
  process.exitCode = 1;
}).finally(() => close());
