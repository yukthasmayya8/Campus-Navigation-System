const { Pool, types } = require('pg');
const config = require('./config');

// BIGINT (ids) -> JS number (safe for this project's scale). COUNT() also returns bigint.
types.setTypeParser(20, (v) => Number(v));

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
      statement_timeout: 15000,
    });
    // An idle client erroring must not crash the process.
    pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  }
  return pool;
}

const query = (text, params) => getPool().query(text, params);

/**
 * Runs fn(client) inside one transaction. Rolls back on ANY error (route + points +
 * snapshot + audit succeed or fail together). Retries once on serialization/deadlock.
 */
async function withTransaction(fn, attempt = 1) {
  const client = await getPool().connect();
  let retry = false;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) { console.error('[db] rollback failed:', rbErr.message); }
    if ((err.code === '40001' || err.code === '40P01') && attempt < 2) retry = true;
    else throw err;
  } finally {
    client.release();
  }
  return retry ? withTransaction(fn, attempt + 1) : undefined;
}

const close = async () => { if (pool) { await pool.end(); pool = undefined; } };

module.exports = { query, withTransaction, getPool, close };
