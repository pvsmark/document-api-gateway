const { createHttpError } = require('../utils/httpError');
const { sha256Hex, hmacSha256Base64Url, timingSafeEqualText } = require('../utils/crypto');

class NonceStore {
  constructor({ ttlSeconds, maxEntries }) {
    this.ttlMs = ttlSeconds * 1000;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  cleanup() {
    const now = Date.now();
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key);
    }
  }

  reserve(keyId, nonce) {
    this.cleanup();
    const key = `${keyId}:${nonce}`;
    if (this.entries.has(key)) return false;
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest) this.entries.delete(oldest);
    }
    this.entries.set(key, Date.now() + this.ttlMs);
    return true;
  }
}

function requiredHeader(req, name) {
  const value = String(req.get(name) || '').trim();
  if (!value) throw createHttpError(401, 'Service authentication failed.', 'SERVICE_AUTH_MISSING');
  return value;
}

function createServiceAuthMiddleware(config, options = {}) {
  const nonceStore = options.nonceStore || new NonceStore({
    ttlSeconds: config.serviceAuth.nonceTtlSeconds,
    maxEntries: config.serviceAuth.maxNonces,
  });
  const nowSeconds = options.nowSeconds || (() => Math.floor(Date.now() / 1000));

  function middleware(req, res, next) {
    try {
      const keyId = requiredHeader(req, 'X-PVS-Key-Id');
      const timestamp = requiredHeader(req, 'X-PVS-Timestamp');
      const nonce = requiredHeader(req, 'X-PVS-Nonce');
      const requestId = requiredHeader(req, 'X-PVS-Request-Id');
      const bodyHash = requiredHeader(req, 'X-PVS-Content-SHA256').toLowerCase();
      const signature = requiredHeader(req, 'X-PVS-Signature');
      const secret = config.serviceAuth.keys[keyId];

      if (!secret || !/^\d{10}$/.test(timestamp) || !/^[A-Fa-f0-9]{64}$/.test(bodyHash)) {
        throw createHttpError(401, 'Service authentication failed.', 'SERVICE_AUTH_INVALID');
      }

      if (Math.abs(nowSeconds() - Number(timestamp)) > config.serviceAuth.maxClockSkewSeconds) {
        throw createHttpError(401, 'Service authentication failed.', 'SERVICE_AUTH_EXPIRED');
      }

      const hasCapturedBody = Buffer.isBuffer(req.rawBody);
      if (hasCapturedBody) {
        const actualHash = sha256Hex(req.rawBody);
        if (!timingSafeEqualText(actualHash, bodyHash)) {
          throw createHttpError(401, 'Service authentication failed.', 'SERVICE_AUTH_BODY_HASH_INVALID');
        }
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        const emptyHash = sha256Hex(Buffer.alloc(0));
        if (!timingSafeEqualText(emptyHash, bodyHash)) {
          throw createHttpError(401, 'Service authentication failed.', 'SERVICE_AUTH_BODY_HASH_INVALID');
        }
      }

      const canonical = [
        req.method.toUpperCase(),
        req.originalUrl,
        timestamp,
        nonce,
        requestId,
        bodyHash,
        keyId,
      ].join('\n');
      const expected = hmacSha256Base64Url(secret, canonical);
      if (!timingSafeEqualText(expected, signature)) {
        throw createHttpError(401, 'Service authentication failed.', 'SERVICE_AUTH_INVALID');
      }

      if (!nonceStore.reserve(keyId, nonce)) {
        throw createHttpError(401, 'Service authentication failed.', 'SERVICE_AUTH_REPLAYED');
      }

      req.serviceAuth = {
        keyId,
        requestId,
        bodyHash,
        bodyHashVerified: hasCapturedBody || req.method === 'GET' || req.method === 'HEAD',
      };
      req.callerKeyId = keyId;
      return next();
    } catch (error) {
      return next(error);
    }
  }

  middleware.nonceStore = nonceStore;
  return middleware;
}

module.exports = { NonceStore, createServiceAuthMiddleware };