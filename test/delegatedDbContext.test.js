const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createDelegatedDbContextMiddleware } = require('../src/middleware/dbContext.middleware');
const { AAD, AUDIENCE } = require('../src/utils/delegatedDbContext');

function tokenFor(key, payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
    cipher.final(),
  ]);
  return ['v1', iv.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

function request(token) {
  return {
    method: 'GET',
    originalUrl: '/v1/documents/8789469?clientId=29',
    serviceAuth: { requestId: 'request-1' },
    get(name) { return name.toLowerCase() === 'x-pvs-db-context' ? token : undefined; },
  };
}

const key = crypto.randomBytes(32);
const config = {
  delegatedDbContext: {
    enabled: true,
    key,
    maxTtlSeconds: 120,
    maxClockSkewSeconds: 30,
  },
};

test('delegated database context binds credentials to the signed request', () => {
  const payload = {
    v: 1,
    aud: AUDIENCE,
    iat: 1000,
    exp: 1060,
    requestId: 'request-1',
    method: 'GET',
    pathAndQuery: '/v1/documents/8789469?clientId=29',
    dbUid: 'cmonte29',
    dbPwd: 'not-a-real-password',
  };
  const req = request(tokenFor(key, payload));
  let error;
  createDelegatedDbContextMiddleware(config, { nowSeconds: () => 1010 })(req, {}, (value) => { error = value; });
  assert.equal(error, undefined);
  assert.deepEqual(req.dbCredentials, { uid: 'cmonte29', pwd: 'not-a-real-password' });
});

test('delegated database context rejects a token copied to another path', () => {
  const payload = {
    v: 1,
    aud: AUDIENCE,
    iat: 1000,
    exp: 1060,
    requestId: 'request-1',
    method: 'GET',
    pathAndQuery: '/v1/documents/1?clientId=29',
    dbUid: 'cmonte29',
    dbPwd: 'not-a-real-password',
  };
  const req = request(tokenFor(key, payload));
  let error;
  createDelegatedDbContextMiddleware(config, { nowSeconds: () => 1010 })(req, {}, (value) => { error = value; });
  assert.equal(error.code, 'DB_CONTEXT_INVALID');
  assert.equal(req.dbCredentials, undefined);
});