const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db');
const { unauthorized, forbidden, AppError } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const COOKIE_NAME = 'campus_nav_token';

const cookieOptions = () => ({
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: config.cookieSecure ? 'none' : 'lax', // 'none' needed when frontend/backend are on different hosted domains
  maxAge: 8 * 60 * 60 * 1000,
  path: '/',
});

const signToken = (user) =>
  jwt.sign({ sub: String(user.user_id) }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

function extractToken(req) {
  const h = req.headers.authorization;
  if (h && /^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, '').trim();
  return req.cookies && req.cookies[COOKIE_NAME];
}

/**
 * Loads the user from the DB on every request, so deactivating an account or changing a
 * role takes effect immediately (a stale JWT cannot keep old permissions).
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw unauthorized();
  let payload;
  try { payload = jwt.verify(token, config.jwtSecret); }
  catch (e) { throw unauthorized(e.name === 'TokenExpiredError' ? 'Session expired. Please log in again.' : 'Invalid session'); }

  const { rows } = await query(
    `SELECT u.user_id, u.name, u.email, u.account_status, u.force_password_change, r.role_name
       FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = $1`, [payload.sub]);
  const u = rows[0];
  if (!u || u.account_status !== 'active') throw unauthorized('Account is not active');
  req.user = {
    id: u.user_id, name: u.name, email: u.email, role: u.role_name,
    isSuperAdmin: u.role_name === 'super_admin', forcePasswordChange: u.force_password_change,
  };
  next();
});

/** Blocks every admin API (except change-password/me/logout) until the forced password change is done. */
const requirePasswordChanged = (req, res, next) => {
  if (req.user.forcePasswordChange)
    return next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your password before continuing'));
  next();
};

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(forbidden());

const requireAdmin = [authenticate, requirePasswordChanged, requireRole('admin', 'super_admin')];
const requireSuperAdmin = [authenticate, requirePasswordChanged, requireRole('super_admin')];

module.exports = { COOKIE_NAME, cookieOptions, signToken, authenticate, requireAdmin, requireSuperAdmin };
