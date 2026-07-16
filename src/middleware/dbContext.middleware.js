const { createHttpError } = require('../utils/httpError');
const {
  AUDIENCE,
  decryptDelegatedDbContext,
} = require('../utils/delegatedDbContext');

function validCredential(value, maxLength) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && !value.includes('\0');
}

function createDelegatedDbContextMiddleware(config, options = {}) {
  const nowSeconds = options.nowSeconds || (() => Math.floor(Date.now() / 1000));

  return function delegatedDbContextMiddleware(req, res, next) {
    if (!config.delegatedDbContext || !config.delegatedDbContext.enabled) return next();

    try {
      const token = String(req.get('X-PVS-DB-Context') || '').trim();
      if (!token) {
        throw createHttpError(401, 'Delegated database context is required.', 'DB_CONTEXT_MISSING');
      }

      const context = decryptDelegatedDbContext(token, config.delegatedDbContext.key);
      const now = nowSeconds();
      const issuedAt = Number(context.iat);
      const expiresAt = Number(context.exp);

      if (
        context.v !== 1
        || context.aud !== AUDIENCE
        || !Number.isSafeInteger(issuedAt)
        || !Number.isSafeInteger(expiresAt)
        || issuedAt > now + config.delegatedDbContext.maxClockSkewSeconds
        || expiresAt <= now
        || expiresAt - issuedAt <= 0
        || expiresAt - issuedAt > config.delegatedDbContext.maxTtlSeconds
        || context.requestId !== req.serviceAuth.requestId
        || context.method !== req.method.toUpperCase()
        || context.pathAndQuery !== req.originalUrl
        || !validCredential(context.dbUid, 256)
        || !validCredential(context.dbPwd, 2048)
      ) {
        throw createHttpError(401, 'Delegated database context is invalid.', 'DB_CONTEXT_INVALID');
      }

      req.dbCredentials = Object.freeze({
        uid: context.dbUid,
        pwd: context.dbPwd,
      });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { createDelegatedDbContextMiddleware };