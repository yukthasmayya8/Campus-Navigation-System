const { AppError } = require('../utils/errors');
const config = require('../config');

const notFoundHandler = (req, res) =>
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found` } });

/** Translate PostgreSQL error codes into safe client responses. */
function mapPgError(err) {
  switch (err.code) {
    case '23505': // unique_violation
      if (err.constraint === 'locations_active_name_uq')
        return new AppError(409, 'DUPLICATE_NAME', 'An active location with this name already exists');
      if (err.constraint === 'users_email_uq')
        return new AppError(409, 'DUPLICATE_EMAIL', 'An account with this e-mail already exists');
      return new AppError(409, 'CONFLICT', 'A record with the same unique value already exists');
    case '23503': return new AppError(400, 'INVALID_REFERENCE', 'A referenced record does not exist');
    case '23514': return new AppError(400, 'CONSTRAINT_VIOLATION', 'A value violates a database rule');
    case '23502': return new AppError(400, 'MISSING_VALUE', 'A required value is missing');
    case '22P02': case '22003': case '22007': case '22008':
      return new AppError(400, 'INVALID_VALUE', 'A value has an invalid format or is out of range');
    case '57014': return new AppError(503, 'DB_TIMEOUT', 'The database took too long to respond. Try again.');
    case '40001': case '40P01': return new AppError(409, 'RETRY', 'The operation collided with another change. Try again.');
    case '28P01': return new AppError(503, 'DB_AUTH_FAILED', 'Database authentication failed. Check DATABASE_URL in backend/.env.');
    case '3D000': return new AppError(503, 'DB_NOT_FOUND', 'The configured database does not exist. Create it or correct DATABASE_URL.');
    case '42P01': return new AppError(503, 'DB_SCHEMA_MISSING', 'Database tables are missing. Run the backend migration before using the app.');
    default: return null;
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let e = err;

  if (err && err.type === 'entity.parse.failed') e = new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  else if (err && err.type === 'entity.too.large') e = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  else if (err && err.name === 'MulterError')
    e = new AppError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'UPLOAD_ERROR',
      err.code === 'LIMIT_FILE_SIZE' ? `Image is larger than ${Math.round(config.maxImageBytes / 1048576)} MB` : err.message);
  else if (err && err.name === 'ZodError')
    e = new AppError(400, 'VALIDATION_ERROR', 'Invalid request data',
      err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  else if (err && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT' ||
    /Connection terminated|timeout exceeded when trying to connect|too many clients/i.test(err.message || '')))
    e = new AppError(503, 'DB_UNAVAILABLE', 'The service is temporarily unavailable. Please try again shortly.');
  else if (!(err instanceof AppError) && err && err.code) e = mapPgError(err) || err;

  if (e instanceof AppError) {
    if (e.status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    return res.status(e.status).json({ error: { code: e.code, message: e.message, ...(e.details !== undefined && { details: e.details }) } });
  }
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server' } });
}

module.exports = { notFoundHandler, errorHandler };
