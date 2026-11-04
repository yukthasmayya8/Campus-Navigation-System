const fs = require('fs');
const path = require('path');
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
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
})().catch((e) => { console.error('Migration failed:', e.message); process.exitCode = 1; }).finally(() => db.close());
