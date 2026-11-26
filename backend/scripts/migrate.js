const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const db = require('../src/db');

(async () => {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
  const sql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN'); await client.query(sql); await client.query('COMMIT');
    const { rows } = await client.query('SELECT PostGIS_Version() AS v');
    console.log('Schema applied. PostGIS', rows[0].v);

    // Idempotent superadmin provisioning for production deploys (Render runs `npm run migrate`).
    const saEmail = (process.env.SUPERADMIN_EMAIL || 'admin@smvitm.ac.in').trim().toLowerCase();
    const saPassword = process.env.SUPERADMIN_TEMP_PASSWORD || process.env.SUPERADMIN_PASSWORD || 'SMVITMAdmin@2024';
    const saName = process.env.SUPERADMIN_NAME || 'Super Admin';
    const forceChange = Boolean(process.env.SUPERADMIN_EMAIL || process.env.SUPERADMIN_TEMP_PASSWORD || process.env.SUPERADMIN_PASSWORD);
    if (saEmail && saPassword) {
      if (saPassword.length < 10) throw new Error('SUPERADMIN password must be at least 10 characters');
      const existing = await client.query(`SELECT 1 FROM users u JOIN roles r USING (role_id) WHERE r.role_name='super_admin' LIMIT 1`);
      if (existing.rows[0]) {
        console.log('A Super Admin already exists; nothing to do.');
      } else {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO users (name,email,password_hash,role_id,force_password_change) VALUES ($1,$2,$3,2,$4)`,
          [saName, saEmail, await bcrypt.hash(saPassword, 12), forceChange],
        );
        await client.query('COMMIT');
        console.log(`Super Admin created: ${saEmail}${forceChange ? ' (password change is forced on first login)' : ''}`);
      }
    } else {
      console.log('No superadmin credentials available; skipping superadmin seed.');
    }

    // Seed baseline campus data only when the database is empty, so production edits are preserved.
    const countRes = await client.query('SELECT COUNT(*)::int AS c FROM locations');
    if (countRes.rows[0].c === 0) {
      console.log('No locations found; seeding SMVITM baseline data...');
      execFileSync(process.execPath, [path.join(__dirname, 'seed-smvitm.js')], { stdio: 'inherit' });
    } else {
      console.log(`Locations already present (${countRes.rows[0].c}); skipping baseline seed.`);
    }
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
})().catch((e) => { console.error('Migration failed:', e.message); process.exitCode = 1; }).finally(() => db.close());