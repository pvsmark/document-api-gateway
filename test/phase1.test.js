const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');

const SECRET = 'test-secret-that-is-at-least-thirty-two-characters';

function environment() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3100',
    ALLOWED_CALLER_IPS: '127.0.0.1',
    SERVICE_AUTH_KEYS_JSON: JSON.stringify({ 'pvs-web2': SECRET }),
    SERVICE_AUTH_MAX_CLOCK_SKEW_SECONDS: '120',
    SERVICE_AUTH_NONCE_TTL_SECONDS: '300',
    SERVICE_AUTH_MAX_NONCES: '100',
    DB_DSN: 'Test',
    DB_UID: 'Test',
    DB_PWD: 'Test',
    DOCUMENT_SOURCE_ROOT: '\\\\fs2\\public\\PTS Share\\Client Services',
    GENERATED_REPORT_ROOT: '\\\\fs2\\public\\PTS Share\\Client Services\\AI Summaries',
    DOCUMENT_TEMP_ROOT: './temp',
  };
}

Object.assign(process.env, environment());

const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config/env');
const { hmacSha256Base64Url, sha256Hex } = require('../src/utils/crypto');
const { createLogger } = require('../src/utils/logger');

function config() {
  return { ...loadConfig(environment()), port: 0, logLevel: 'silent' };
}

async function startServer() {
  const app = createApp({
    config: config(),
    logger: createLogger('silent'),
    readinessCheck: async () => ({
      database: 'ok',
      sourceStorage: 'ok',
      generatedStorage: 'ok',
      temporaryStorage: 'ok',
    }),
    configureV1Routes(router) {
      router.all('/test', (req, res) => res.json({ ok: true }));
    },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function signedHeaders(pathAndQuery = '/v1/test', overrides = {}) {
  const timestamp = String(overrides.timestamp || Math.floor(Date.now() / 1000));
  const nonce = overrides.nonce || crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const bodyHash = sha256Hex(Buffer.alloc(0));
  const canonical = ['GET', pathAndQuery, timestamp, nonce, requestId, bodyHash, 'pvs-web2'].join('\n');
  return {
    'X-PVS-Key-Id': 'pvs-web2',
    'X-PVS-Timestamp': timestamp,
    'X-PVS-Nonce': nonce,
    'X-PVS-Request-Id': requestId,
    'X-PVS-Content-SHA256': bodyHash,
    'X-PVS-Signature': hmacSha256Base64Url(SECRET, canonical),
  };
}

test('configuration rejects short service secrets', () => {
  const values = environment();
  values.SERVICE_AUTH_KEYS_JSON = JSON.stringify({ 'pvs-web2': 'short' });
  assert.throws(() => loadConfig(values), /at least 32 characters/);
});

test('configuration rejects a temporary root outside the project', () => {
  const values = environment();
  values.DOCUMENT_TEMP_ROOT = '../outside';
  assert.throws(() => loadConfig(values), /inside the project root/);
});

test('health endpoints return safe status only', async (t) => {
  const service = await startServer();
  t.after(service.close);
  const response = await fetch(`${service.baseUrl}/health/ready`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(body).includes('fs2'), false);
  assert.equal(body.database, 'ok');
});

test('valid signed request is accepted', async (t) => {
  const service = await startServer();
  t.after(service.close);
  assert.equal((await fetch(`${service.baseUrl}/v1/test`, { headers: signedHeaders() })).status, 200);
});

test('changed query invalidates signature', async (t) => {
  const service = await startServer();
  t.after(service.close);
  const response = await fetch(`${service.baseUrl}/v1/test?clientId=30`, {
    headers: signedHeaders('/v1/test?clientId=29'),
  });
  assert.equal(response.status, 401);
});

test('reused nonce is rejected', async (t) => {
  const service = await startServer();
  t.after(service.close);
  const headers = signedHeaders('/v1/test', { nonce: 'fixed-nonce-12345' });
  assert.equal((await fetch(`${service.baseUrl}/v1/test`, { headers })).status, 200);
  assert.equal((await fetch(`${service.baseUrl}/v1/test`, { headers })).status, 401);
});
