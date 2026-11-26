require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/db');

(async () => {
  const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD in the environment');
  if (password.length < 10) throw new Error('SUPERADMIN_PASSWORD must be at least 10 characters');

  const { rows } = await db.query(
    `SELECT u.user_id, r.role_name FROM users u JOIN roles r USING (role_id) WHERE u.email=$1`,
    [email],
  );
  if (!rows[0]) throw new Error(`No account found for ${email}`);
  if (rows[0].role_name !== 'super_admin') throw new Error(`${email} is not a Super Admin account`);

  await db.query(
    `UPDATE users SET password_hash=$2, force_password_change=TRUE, updated_at=now() WHERE user_id=$1`,
    [rows[0].user_id, await bcrypt.hash(password, 12)],
  );
  console.log(`Super Admin password reset for ${email}; change it at next login.`);
})().catch((error) => {
  console.error('Password reset failed:', error.message);
  process.exitCode = 1;
}).finally(() => db.close());
