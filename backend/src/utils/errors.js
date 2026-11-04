class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const badRequest = (msg, details) => new AppError(400, 'BAD_REQUEST', msg, details);
const unauthorized = (msg = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', msg);
const forbidden = (msg = 'You do not have permission to perform this action') => new AppError(403, 'FORBIDDEN', msg);
const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
const conflict = (msg, details, code = 'CONFLICT') => new AppError(409, code, msg, details);
const versionConflict = (entity, expected, current) =>
  new AppError(409, 'VERSION_CONFLICT',
    `${entity} was changed by someone else. Reload and try again.`,
    { expectedVersion: expected, currentVersion: current.version_number ?? current.versionNumber, current });

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, versionConflict };
