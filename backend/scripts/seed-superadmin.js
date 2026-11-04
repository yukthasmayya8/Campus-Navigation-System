const bcrypt = require('bcryptjs');
const config = require('../src/config');
const db = require('../src/db');

(async () => {
  const { SUPERADMIN_NAME: name = 'Super Admin', SUPERADMIN_EMAIL: email, SUPERADMIN_PASSWORD: pw } = process.env;
  if (!email || !pw) throw new Error('Set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD in .env');
  if (pw.length < 10) throw new Error('SUPERADMIN_PASSWORD must be at least 10 characters');
  const { rows } = await db.query(`SELECT 1 FROM users u JOIN roles r USING (role_id) WHERE r.role_name='super_admin' LIMIT 1`);
  if (rows[0]) return console.log('A Super Admin already exists; nothing to do.');
  await db.query(`INSERT INTO users (name,email,password_hash,role_id,force_password_change) VALUES ($1,$2,$3,2,TRUE)`,
    [name, email.trim().toLowerCase(), await bcrypt.hash(pw, 12)]);
  console.log(`Super Admin created: ${email} (password change is forced on first login)`);
})().catch((e) => { console.error('Seed failed:', e.message); process.exitCode = 1; }).finally(() => db.close());
