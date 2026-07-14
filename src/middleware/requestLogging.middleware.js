function createRequestLoggingMiddleware(logger) {
  return function requestLoggingMiddleware(req, res, next) {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info('request_completed', {
        requestId: req.requestId,
        operation: `${req.method} ${req.path}`,
        callerKeyId: req.callerKeyId,
        status: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
      });
    });
    next();
  };
}

module.exports = { createRequestLoggingMiddleware };
