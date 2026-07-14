const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const { Readable } = require('stream');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config/env');
const { createDocumentsService } = require('../src/modules/documents/documents.service');
const { resolveSourcePath } = require('../src/modules/documents/documents.storage');
const { hmacSha256Base64Url, sha256Hex } = require('../src/utils/crypto');
const { createLogger } = require('../src/utils/logger');

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

function config() {
  return { ...loadConfig(environment()), port: 0, logLevel: 'silent' };
}

function signedHeaders(pathAndQuery) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
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

async function startServer(documentsService) {
  const database = {
    checkHealth: async () => [{ Healthy: 1 }],
    close: async () => undefined,
    query: async () => [],
  };
  const app = createApp({
    config: config(),
    logger: createLogger('silent'),
    database,
    documentsService,
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

test('source path inside approved root is accepted', () => {
  const root = '\\\\fs2\\public\\PTS Share\\Client Services';
  const resolved = resolveSourcePath({ SourceRelativePath: '29\\2025\\document.pdf' }, root);
  assert.equal(resolved, '\\\\fs2\\public\\PTS Share\\Client Services\\29\\2025\\document.pdf');
});

test('source path traversal is rejected', () => {
  const root = '\\\\fs2\\public\\PTS Share\\Client Services';
  assert.throws(
    () => resolveSourcePath({ SourceRelativePath: '..\\..\\secret.txt' }, root),
    (error) => error.code === 'DOCUMENT_SOURCE_PATH_FORBIDDEN',
  );
});

test('absolute relative source path is rejected', () => {
  const root = '\\\\fs2\\public\\PTS Share\\Client Services';
  assert.throws(
    () => resolveSourcePath({ SourceRelativePath: 'C:\\secret.txt' }, root),
    (error) => error.code === 'DOCUMENT_SOURCE_PATH_UNSUPPORTED',
  );
});

test('service rejects a document that does not belong to the client', async () => {
  const service = createDocumentsService({
    repository: {
      findDocumentById: async () => null,
      findDocumentSourcePath: async () => { throw new Error('must not be called'); },
    },
    storage: { prepareSource: async () => { throw new Error('must not be called'); } },
  });
  await assert.rejects(
    service.getDocument({ clientId: 29, documentId: 12345 }),
    (error) => error.code === 'DOCUMENT_NOT_FOUND' && error.status === 404,
  );
});

test('signed document request streams bytes and safe headers', async (t) => {
  const payload = Buffer.from('%PDF-test-document', 'utf8');
  const service = await startServer({
    async getDocument({ clientId, documentId }) {
      assert.equal(clientId, 29);
      assert.equal(documentId, 12345);
      return {
        documentId,
        displayName: 'Property Document.pdf',
        contentType: 'application/pdf',
        size: payload.length,
        stream: Readable.from(payload),
      };
    },
  });
  t.after(service.close);

  const pathAndQuery = '/v1/documents/12345?clientId=29';
  const response = await fetch(`${service.baseUrl}${pathAndQuery}`, {
    headers: signedHeaders(pathAndQuery),
  });
  const body = Buffer.from(await response.arrayBuffer());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('x-pvs-document-id'), '12345');
  assert.deepEqual(body, payload);
});

test('invalid clientId is rejected before document service runs', async (t) => {
  let called = false;
  const service = await startServer({
    async getDocument() {
      called = true;
      throw new Error('must not be called');
    },
  });
  t.after(service.close);

  const pathAndQuery = '/v1/documents/12345?clientId=bad';
  const response = await fetch(`${service.baseUrl}${pathAndQuery}`, {
    headers: signedHeaders(pathAndQuery),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.equal(called, false);
});

test('null byte in source path is rejected', () => {
  const root = '\\\\fs2\\public\\PTS Share\\Client Services';
  assert.throws(
    () => resolveSourcePath({ SourceRelativePath: '29\\bad\0name.pdf' }, root),
    (error) => error.code === 'DOCUMENT_SOURCE_PATH_UNSUPPORTED',
  );
});

test('storage maps missing and access-denied files to safe 404', async () => {
  const { createDocumentsStorage } = require('../src/modules/documents/documents.storage');
  for (const code of ['ENOENT', 'EACCES', 'EPERM']) {
    const storage = createDocumentsStorage(config(), {
      fsp: { stat: async () => { const error = new Error('hidden'); error.code = code; throw error; } },
      fs: { createReadStream: () => { throw new Error('must not be called'); } },
    });
    await assert.rejects(
      storage.prepareSource({ SourceRelativePath: '29\\document.pdf' }),
      (error) => error.status === 404
        && error.code === 'DOCUMENT_FILE_NOT_FOUND'
        && !error.message.includes('fs2'),
    );
  }
});

test('storage rejects directories as documents', async () => {
  const { createDocumentsStorage } = require('../src/modules/documents/documents.storage');
  const storage = createDocumentsStorage(config(), {
    fsp: { stat: async () => ({ isFile: () => false, size: 0, mtime: new Date() }) },
    fs: { createReadStream: () => { throw new Error('must not be called'); } },
  });
  await assert.rejects(
    storage.prepareSource({ SourceRelativePath: '29\\folder' }),
    (error) => error.status === 404 && error.code === 'DOCUMENT_FILE_NOT_FOUND',
  );
});
