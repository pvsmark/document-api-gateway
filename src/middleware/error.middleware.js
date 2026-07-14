const { HttpError, createHttpError } = require('../utils/httpError');
const { safeError } = require('../utils/logger');

function notFound(req, res, next) {
  next(createHttpError(404, 'Route not found.', 'ROUTE_NOT_FOUND'));
}

function createErrorHandler(config, logger) {
  return function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);
    const known = error instanceof HttpError;
    const status = known ? error.status : 500;
    const code = known ? error.code : 'INTERNAL_ERROR';
    const message = known && error.expose ? error.message : 'An internal error occurred.';
    logger.error('request_failed', {
      requestId: req.requestId,
      operation: `${req.method} ${req.path}`,
      callerKeyId: req.callerKeyId,
      status,
      error: safeError(error),
    });
    return res.status(status).json({ error: { code, message, requestId: req.requestId } });
  };
}

module.exports = { notFound, createErrorHandler };
