const { createHttpError } = require('../utils/httpError');

function normalizeIp(value) {
  const selected = String(value || '').trim();
  return selected.startsWith('::ffff:') ? selected.slice(7) : selected;
}

function createIpAllowlistMiddleware(config) {
  const allowed = new Set(config.allowedCallerIps.map(normalizeIp));
  const allowAnyCaller = allowed.has('*');

  return function ipAllowlistMiddleware(req, res, next) {
    const callerIp = normalizeIp(req.ip || req.socket.remoteAddress);

    if (!allowAnyCaller && !allowed.has(callerIp)) {
      return next(
        createHttpError(
          403,
          'Caller is not allowed.',
          'CALLER_IP_FORBIDDEN',
        ),
      );
    }

    req.callerIp = callerIp;
    return next();
  };
}

module.exports = {
  createIpAllowlistMiddleware,
  normalizeIp,
};