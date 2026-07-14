const crypto = require('crypto');

function requestIdMiddleware(req, res, next) {
  const supplied = String(req.get('X-PVS-Request-Id') || '').trim();
  req.requestId = /^[A-Za-z0-9._:-]{8,128}$/.test(supplied) ? supplied : crypto.randomUUID();
  res.setHeader('X-PVS-Request-Id', req.requestId);
  next();
}

module.exports = { requestIdMiddleware };
