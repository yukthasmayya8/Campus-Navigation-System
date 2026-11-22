const bcrypt = require('bcryptjs');
const db = require('../src/db');

const accounts = [
  {
    name: process.env.ADMIN_NAME || 'Campus Admin',
    email: (process.env.ADMIN_EMAIL || 'admin@smvitm.ac.in').trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD || 'SMVITMAdmin@2024',
    role: 'admin',
  },
  {
    name: process.env.SUPERADMIN_NAME || 'SMVITM Super Admin',
    email: (process.env.SUPERADMIN_EMAIL || 'superadmin@smvitm.ac.in').trim().toLowerCase(),
    password: process.env.SUPERADMIN_PASSWORD || 'SMVITMSuperAdmin@2024',
    role: 'super_admin',
  },
];

(async () => {
  for (const account of accounts) {
    if (account.password.length < 10) {
      throw new Error(`Password for ${account.email} must be at least 10 characters`);
    }

    await db.query(
      `INSERT INTO users
        (name, email, password_hash, role_id, account_status, force_password_change)
       VALUES
        ($1, $2, $3,
         (SELECT role_id FROM roles WHERE role_name = $4),
         'active', false)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         role_id = EXCLUDED.role_id,
         account_status = 'active',
         force_password_change = false,
         updated_at = now()
       RETURNING user_id`,
      [account.name, account.email, await bcrypt.hash(account.password, 12), account.role],
    );
    console.log(`Seeded ${account.role}: ${account.email}`);
  }
})().catch((error) => {
  console.error('Account seed failed:', error.message);
  process.exitCode = 1;
}).finally(() => db.close());
