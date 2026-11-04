const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { unauthorized } = require('../utils/errors');
const { z, password, email } = require('../utils/schemas');
const { authenticate, signToken, cookieOptions, COOKIE_NAME } = require('../middleware/auth');
const users = require('../services/users');

const publicUser = (u) => ({ userId: u.user_id ?? u.id, name: u.name, email: u.email, role: u.role_name ?? u.role,
  forcePasswordChange: u.force_password_change ?? u.forcePasswordChange,
  canRestore: (u.role_name ?? u.role) === 'super_admin' }); // drives the Restore button in the UI

router.post('/login', asyncHandler(async (req, res) => {
  const { email: e, password: p } = z.object({ email, password: z.string().min(1).max(128) }).parse(req.body);
  const u = await users.verifyLogin(e, p);
  if (!u) throw unauthorized('Invalid e-mail or password');
  res.cookie(COOKIE_NAME, signToken(u), cookieOptions());
  res.json({ user: publicUser(u) });
}));

router.post('/logout', (req, res) => { res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined }); res.json({ ok: true }); });

router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

router.post('/change-password', authenticate, asyncHandler(async (req, res) => {
  const b = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).parse(req.body);
  await users.changePassword(req.user.id, b.currentPassword, b.newPassword);
  res.json({ ok: true });
}));

router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email: e } = z.object({ email }).parse(req.body);
  await users.requestReset(e);
  res.json({ ok: true, message: 'If that account exists, a reset link has been sent.' });
}));

router.post('/reset-password', asyncHandler(async (req, res) => {
  const b = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid token'), newPassword: password }).parse(req.body);
  await users.resetPassword(b.token, b.newPassword);
  res.json({ ok: true });
}));

module.exports = router;
