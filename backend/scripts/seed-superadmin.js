const bcrypt = require('bcryptjs');
const config = require('../src/config');
const db = require('../src/db');

(async () => {
  const { SUPERADMIN_NAME: name = 'Super Admin', SUPERADMIN_EMAIL: email, SUPERADMIN_PASSWORD: pw } = process.env;
  if (!email || !pw) {
    console.log('Super Admin bootstrap skipped; SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD are not configured.');
    return;
  }
  if (pw.length < 10) throw new Error('SUPERADMIN_PASSWORD must be at least 10 characters');
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.query(
    `SELECT r.role_name FROM users u JOIN roles r USING (role_id) WHERE u.email=$1`,
    [normalizedEmail],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].role_name !== 'super_admin') {
      throw new Error(`${normalizedEmail} already belongs to a non-Super Admin account`);
    }
    console.log(`Super Admin already exists: ${normalizedEmail}; account and password left unchanged.`);
    return;
  }
  await db.query(
    `INSERT INTO users (name,email,password_hash,role_id,account_status,force_password_change)
     VALUES ($1,$2,$3,(SELECT role_id FROM roles WHERE role_name='super_admin'),'active',TRUE)`,
    [name, normalizedEmail, await bcrypt.hash(pw, 12)],
  );
  console.log(`Super Admin created: ${normalizedEmail} (password change is forced on first login)`);
})().catch((e) => { console.error('Seed failed:', e.message); process.exitCode = 1; }).finally(() => db.close());
