const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { query } = require('./db');
const { notFoundHandler, errorHandler } = require('./middleware/error');

const limiter = (windowMs, max, message) => rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message } } });

function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Render/Railway proxies: correct client IP for rate limiting
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })); // allow frontend to display /uploads images
  app.use(cors({
    origin: (origin, cb) => (!origin || config.corsOrigins.includes(origin) ? cb(null, true) : cb(null, false)),
    credentials: true,
  }));
  app.use(express.json({ limit: '5mb' })); // route geometry can be large
  app.use(cookieParser());
  app.use('/uploads', express.static(config.uploadDir, { fallthrough: true, maxAge: '7d', index: false }));

  app.get('/api/health', async (req, res) => {
    try { await query('SELECT 1'); res.json({ status: 'ok' }); }
    catch (e) { res.status(503).json({ status: 'degraded', database: 'unavailable' }); }
  });

  app.use('/api', limiter(60 * 1000, 300, 'Too many requests. Please slow down.'));
  app.use('/api/auth/login', limiter(15 * 60 * 1000, 10, 'Too many login attempts. Try again in 15 minutes.'));
  app.use('/api/auth/forgot-password', limiter(60 * 60 * 1000, 5, 'Too many reset requests. Try again later.'));
  app.use('/api/auth/reset-password', limiter(60 * 60 * 1000, 10, 'Too many attempts. Try again later.'));

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api', require('./routes/public'));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };
