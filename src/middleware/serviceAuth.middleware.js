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
    this