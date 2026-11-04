require('dotenv').config();
const path = require('path');

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && v !== undefined && v !== '' ? n : d; };
const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));

const env = process.env.NODE_ENV || 'development';
const config = {
  env,
  isProd: env === 'production',
  port: num(process.env.PORT, 4000),
  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: bool(process.env.DATABASE_SSL, false),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  cookieSecure: bool(process.env.COOKIE_SECURE, env === 'production'),
  storageDriver: process.env.STORAGE_DRIVER || 'local',
  uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads'),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${num(process.env.PORT, 4000)}`).replace(/\/$/, ''),
  maxImageBytes: num(process.env.MAX_IMAGE_MB, 3) * 1024 * 1024,
  duplicateRadiusM: num(process.env.DUPLICATE_RADIUS_M, 15),
  smtpUrl: process.env.SMTP_URL || '',
  mailFrom: process.env.MAIL_FROM || 'Campus Navigation <no-reply@localhost>',
  frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, ''),
  limits: { maxPointsPerRoute: 20000, maxPointsPerBatch: 500, maxWaypoints: 50 },
};

/** Fail fast on bad configuration instead of failing on the first request. */
config.validate = () => {
  const problems = [];
  if (!config.databaseUrl) problems.push('DATABASE_URL is required');
  if (!config.jwtSecret || config.jwtSecret.length < 32) problems.push('JWT_SECRET must be set and at least 32 characters');
  if (!['local'].includes(config.storageDriver)) problems.push(`Unsupported STORAGE_DRIVER "${config.storageDriver}"`);
  if (problems.length) throw new Error('Invalid configuration:\n - ' + problems.join('\n - '));
};

module.exports = config;
