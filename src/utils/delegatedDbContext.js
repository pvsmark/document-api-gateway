const crypto = require('crypto');
const { createHttpError } = require('./httpError');

const TOKEN_VERSION = 'v1';
const AUDIENCE = 'pvs-document-api-gateway';
const AAD = Buffer.from('pvs-document-gateway-db-context-v1', 'utf8');

function decodeBase64Url(value, name) {
  try {
    return Buffer.from(String(value || ''), 'base64url');
  } catch (error) {
    throw createHttpError(401, 'Delegated database context is invalid.', 'DB_CONTEXT_INVALID');
  }
}

function decryptDelegatedDbContext(token, key) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION || !Buffer.isBuffer(key) || key.length !== 32) {
    throw createHttpError(401, 'Delegated database context is invalid.', 'DB_CONTEXT_INVALID');
  }

  try {
    const iv = decodeBase64Url(parts[1], 'iv');
    const ciphertext = decodeBase64Url(parts[2], 'ciphertext');
    const tag = decodeBase64Url(parts[3], 'tag');
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error('Invalid encrypted context shape.');
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch (error) {
    throw createHttpError(401, 'Delegated database context is invalid.', 'DB_CONTEXT_INVALID');
  }
}

module.exports = {
  AAD,
  AUDIENCE,
  TOKEN_VERSION,
  decryptDelegatedDbContext,
};