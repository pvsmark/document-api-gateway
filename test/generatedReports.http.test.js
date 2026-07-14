const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const { Readable } = require('stream');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config/env');
const { hmacSha256Base64Url, sha256Hex } = require('../src/utils/crypto');
const { createLogger } = require('../src/utils/logger');

const SECRET = 'test-secret-that-is-at-least-thirty-two-characters';
const SUMMARY_ID = '123e4567-e89b-42d3-a456-426614174000';

function config() {
  const values = {
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
    GENERATED_REPORT_MAX_BYTES: '1048576',
  };
  return { ...loadConfig(values), port: 0, logLevel: 'silent' };
}

function signedHeaders(method, pathAndQuery, body, extra = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const bodyHash = sha256Hex(body || Buffer.alloc(0));
  const canonical = [method, pathAndQuery, timestamp, nonce, requestId, bodyHash, 'pvs-web2'].join('\n');
  return {
    'X-PVS-Key-Id': 'pvs-web2',
    'X-PVS-Timestamp': timestamp,
    'X-PVS-Nonce': nonce,
    'X-PVS-Request-Id': requestId,
    'X-PVS-Content-SHA256': bodyHash,
    'X-PVS-Signature': hmacSha256Base64Url(SECRET, canonical),
    ...extra,
  };
}

async function startServer(generatedReportsService) {
  const database = {
    checkHealth: async () => [{ Healthy: 1 }],
    close: async () => undefined,
    query: async () => [],
  };
  const app = createApp({
    config: config(),
    logger: createLogger('silent'),
    database,
    documentsService: { async getDocument() { throw new Error('not used'); } },
    archivesService: {
      async createSelectedArchive() { throw new Error('not used'); },
      async createQueryArchive() { throw new Error('not used'); },
      async cleanup() {},
    },
    generatedReportsService,
    readinessCheck: async () => ({
      database: 'ok',
      sourceStorage: 'ok',
      generatedStorage: 'ok',
      temporaryStorage: 'ok',
    }),
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('signed PDF upload remains a stream and returns safe metadata', async (t) => {
  const pdf = Buffer.from('%PDF-1.7\nhttp upload');
  const expectedHash = sha256Hex(pdf);
  let received;
  const server = await startServer({
    async upload(values, input) {
      const chunks = [];
      for await (const chunk of input) chunks.push(chunk);
      received = Buffer.concat(chunks);
      assert.equal(values.expectedHash, expectedHash);
      return {
        summaryId: values.summaryId,
        clientId: values.clientId,
        currentYear: values.currentYear,
        relativeFilePath: `29\\2025\\${SUMMARY_ID}.pdf`,
        fileSize: received.length,
        fileHash: expectedHash,
        idempotent: false,
      };
    },
    async get() { throw new Error('not used'); },
  });
  t.after(server.close);

  const pathAndQuery = `/v1/generated-reports/${SUMMARY_ID}?clientId=29&currentYear=2025`;
  const response = await fetch(`${server.baseUrl}${pathAndQuery}`, {
    method: 'PUT',
    headers: signedHeaders('PUT', pathAndQuery, pdf, {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'X-PVS-File-Name': 'summary.pdf',
    }),
    body: pdf,
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(received, pdf);
  assert.equal(body.relativeFilePath, `29\\2025\\${SUMMARY_ID}.pdf`);
  assert.equal(JSON.stringify(body).includes('fs2'), false);
});

test('generated report retrieval streams PDF bytes', async (t) => {
  const pdf = Buffer.from('%PDF-1.7\nretrieved');
  const server = await startServer({
    async upload() { throw new Error('not used'); },
    async get(values) {
      return {
        ...values,
        size: pdf.length,
        createReadStream: () => Readable.from(pdf),
      };
    },
  });
  t.after(server.close);

  const pathAndQuery = `/v1/generated-reports/${SUMMARY_ID}?clientId=29&currentYear=2025`;
  const response = await fetch(`${server.baseUrl}${pathAndQuery}`, {
    headers: signedHeaders('GET', pathAndQuery, Buffer.alloc(0)),
  });
  const body = Buffer.from(await response.arrayBuffer());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('x-pvs-summary-id'), SUMMARY_ID);
  assert.deepEqual(body, pdf);
});

test('unsafe upload filename is rejected before service execution', async (t) => {
  const pdf = Buffer.from('%PDF-1.7\nunsafe name');
  let called = false;
  const server = await startServer({
    async upload() { called = true; throw new Error('must not be called'); },
    async get() { throw new Error('not used'); },
  });
  t.after(server.close);

  const pathAndQuery = `/v1/generated-reports/${SUMMARY_ID}?clientId=29&currentYear=2025`;
  const response = await fetch(`${server.baseUrl}${pathAndQuery}`, {
    method: 'PUT',
    headers: signedHeaders('PUT', pathAndQuery, pdf, {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'X-PVS-File-Name': '../summary.pdf',
    }),
    body: pdf,
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.equal(called, false);
});