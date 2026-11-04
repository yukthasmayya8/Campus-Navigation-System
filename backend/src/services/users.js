const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('../config');
const { query, withTransaction } = require('../db');
const { badRequest, notFound, conflict, forbidden } = require('../utils/errors');
const { writeAudit } = require('./audit');
const { sendMail } = require('./mailer');

const ROUNDS = 12;
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', ROUNDS);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const ROLE_ID = { admin: 1, super_admin: 2 };

const toUser = (r) => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role_name,
  accountStatus: r.account_status, forcePasswordChange: r.force_password_change, createdAt: r.created_at });
const UQ = `SELECT u.user_id, u.name, u.email, u.account_status, u.force_password_change, u.created_at, u.password_hash, r.role_name
              FROM users u JOIN roles r ON r.role_id = u.role_id`;

/** Constant-ish time: always runs a bcrypt compare, so e-mail existence is not leaked by timing. */
async function verifyLogin(email, password) {
  const { rows } = await query(`${UQ} WHERE u.email=$1`, [email]);
  const u = rows[0];
  const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok || u.account_status !== 'active') return null;
  return u;
}

async function changePassword(userId, current, next) {
  const { rows } = await query('SELECT password_hash FROM users WHERE user_id=$1', [userId]);
  if (!rows[0] || !(await bcrypt.compare(current, rows[0].password_hash))) throw badRequest('Current password is incorrect');
  if (current === next) throw badRequest('New password must be different from the current one');
  await query('UPDATE users SET password_hash=$2, force_password_change=FALSE, updated_at=now() WHERE user_id=$1',
    [userId, await bcrypt.hash(next, ROUNDS)]);
}

/** Always resolves quietly so the endpoint cannot be used to discover which e-mails exist. */
async function requestReset(email) {
  const { rows } = await query(`SELECT user_id, email FROM users WHERE email=$1 AND account_status='active'`, [email]);
  if (!rows[0]) return;
  const token = crypto.randomBytes(32).toString('hex');
  await withTransaction(async (c) => {
    await c.query('UPDATE password_reset_tokens SET used_status=TRUE WHERE user_id=$1 AND used_status=FALSE', [rows[0].user_id]);
    await c.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expiry_time) VALUES ($1,$2, now() + interval '30 minutes')`,
      [rows[0].user_id, sha256(token)]);
  });
  try {
    await sendMail({ to: rows[0].email, subject: 'Campus Navigation password reset',
      text: `Use this link within 30 minutes:\n${config.frontendUrl}/admin/reset-password?token=${token}\n\nIf you did not request this, ignore this e-mail.` });
  } catch (e) { console.error('[mail] failed to send reset e-mail:', e.message); }
}

async function resetPassword(token, newPassword) {
  return withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT token_id, user_id FROM password_reset_tokens
        WHERE token_hash=$1 AND used_status=FALSE AND expiry_time > now() FOR UPDATE`, [sha256(token)]);
    if (!rows[0]) throw badRequest('This reset link is invalid or has expired');
    await c.query('UPDATE password_reset_tokens SET used_status=TRUE WHERE token_id=$1', [rows[0].token_id]);
    await c.query('UPDATE users SET password_hash=$2, force_password_change=FALSE, updated_at=now() WHERE user_id=$1',
      [rows[0].user_id, await bcrypt.hash(newPassword, ROUNDS)]);
  });
}

/* ---------- Super Admin account management ---------- */
async function list() { return (await query(`${UQ} ORDER BY u.user_id`)).rows.map(toUser); }

async function create(actor, { name, email, role, temporaryPassword }) {
  const temp = temporaryPassword || crypto.randomBytes(9).toString('base64url') + 'aA1';
  return withTransaction(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO users (name, email, password_hash, role_id, force_password_change) VALUES ($1,$2,$3,$4,TRUE) RETURNING user_id`,
      [name, email, await bcrypt.hash(temp, ROUNDS), ROLE_ID[role]]);
    await writeAudit(c, { userId: actor.id, action: 'user.create', entityType: 'user', entityId: rows[0].user_id, next: { name, email, role } });
    const u = (await c.query(`${UQ} WHERE u.user_id=$1`, [rows[0].user_id])).rows[0];
    return { user: toUser(u), temporaryPassword: temp }; // shown once; user must change it at first login
  });
}

async function update(actor, id, { name, role, accountStatus }) {
  return withTransaction(async (c) => {
    const { rows } = await c.query(`${UQ} WHERE u.user_id=$1 FOR UPDATE OF u`, [id]);
    const u = rows[0];
    if (!u) throw notFound('User');
    const losingSuper = u.role_name === 'super_admin' && ((role && role !== 'super_admin') || accountStatus === 'inactive');
    if (losingSuper) {
      if (id === actor.id) throw forbidden('You cannot demote or deactivate your own Super Admin account');
      const n = (await c.query(`SELECT count(*) AS n FROM users u JOIN roles r USING (role_id)
                                 WHERE r.role_name='super_admin' AND u.account_status='active'`)).rows[0].n;
      if (n <= 1) throw conflict('At least one active Super Admin must remain', undefined, 'LAST_SUPER_ADMIN');
    }
    await c.query(`UPDATE users SET name=COALESCE($2,name), role_id=COALESCE($3,role_id), account_status=COALESCE($4,account_status), updated_at=now() WHERE user_id=$1`,
      [id, name ?? null, role ? ROLE_ID[role] : null, accountStatus ?? null]);
    const after = (await c.query(`${UQ} WHERE u.user_id=$1`, [id])).rows[0];
    await writeAudit(c, { userId: actor.id, action: 'user.update', entityType: 'user', entityId: id,
      previous: { name: u.name, role: u.role_name, accountStatus: u.account_status }, next: { name: after.name, role: after.role_name, accountStatus: after.account_status } });
    return toUser(after);
  });
}

module.exports = { verifyLogin, changePassword, requestReset, resetPassword, list, create, update, toUser, ROUNDS, ROLE_ID };
