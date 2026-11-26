const bcrypt = require('bcryptjs');
const db = require('../src/db');

const accounts = [
  {
    name: process.env.ADMIN_NAME || 'Campus Admin',
    email: (process.env.ADMIN_EMAIL || 'admin@smvitm.ac.in').trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD,
    role: 'admin',
  },
  {
    name: process.env.SUPERADMIN_NAME || 'SMVITM Super Admin',
    email: (process.env.SUPERADMIN_EMAIL || 'superadmin@smvitm.ac.in').trim().toLowerCase(),
    password: process.env.SUPERADMIN_PASSWORD,
    role: 'super_admin',
  },
];

(async () => {
  if (accounts[0].email === accounts[1].email) throw new Error('ADMIN_EMAIL and SUPERADMIN_EMAIL must be different');
  for (const account of accounts) {
    if (!account.password) throw new Error(`Set ${account.role === 'admin' ? 'ADMIN' : 'SUPERADMIN'}_PASSWORD in the environment`);
    if (account.password.length < 10) {
      throw new Error(`Password for ${account.email} must be at least 10 characters`);
    }

    const { rows } = await db.query(
      `INSERT INTO users
        (name, email, password_hash, role_id, account_status, force_password_change)
       VALUES
        ($1, $2, $3,
         (SELECT role_id FROM roles WHERE role_name = $4),
         'active', true)
       ON CONFLICT (email) DO NOTHING
       RETURNING user_id`,
      [account.name, account.email, await bcrypt.hash(account.password, 12), account.role],
    );
    if (rows[0]) {
      console.log(`Created ${account.role}: ${account.email} (password change required at first login)`);
      continue;
    }

    const existing = await db.query(
      `SELECT r.role_name FROM users u JOIN roles r USING (role_id) WHERE u.email=$1`,
      [account.email],
    );
    if (existing.rows[0]?.role_name !== account.role) {
      throw new Error(`${account.email} already belongs to a different role; no account changes were made`);
    }
    console.log(`Already exists; left unchanged: ${account.email}`);
  }
})().catch((error) => {
  console.error('Account seed failed:', error.message);
  process.exitCode = 1;
}).finally(() => db.close());
