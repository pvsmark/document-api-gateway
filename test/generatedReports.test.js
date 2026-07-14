const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const {
  buildReportLocation,
  createGeneratedReportsStorage,
} = require('../src/modules/generatedReports/generatedReports.storage');
const {
  parseFileName,
  parseSummaryId,
  validateGeneratedReportUpload,
} = require('../src/modules/generatedReports/generatedReports.validation');

const SUMMARY_ID = '123e4567-e89b-42d3-a456-426614174000';

function requestFixture(overrides = {}) {
  const headers = {
    'content-type': 'application/pdf',
    'content-length': '10',
    'x-pvs-content-sha256': 'a'.repeat(64),
    'x-pvs-file-name': 'summary.pdf',
    ...overrides.headers,
  };
  return {
    params: { summaryId: SUMMARY_ID, ...overrides.params },
    query: { clientId: '29', currentYear: '2025', ...overrides.query },
    get(name) { return headers[String(name).toLowerCase()]; },
  };
}

function runUploadValidation(req, maxBytes = 1024) {
  return new Promise((resolve, reject) => {
    validateGeneratedReportUpload({ generatedReports: { maxBytes } })(
      req,
      {},
      (error) => (error ? reject(error) : resolve(req.validated)),
    );
  });
}

async function storageFixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pvs-report-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const config = {
    storage: { generatedReportRoot: root },
    generatedReports: { maxBytes: 1024 * 1024 },
  };
  return {
    root,
    storage: createGeneratedReportsStorage(config, { path }),
  };
}

function valuesFor(buffer, overrides = {}) {
  return {
    summaryId: SUMMARY_ID,
    clientId: 29,
    currentYear: 2025,
    fileName: 'Client Summary.pdf',
    contentLength: buffer.length,
    expectedHash: crypto.createHash('sha256').update(buffer).digest('hex'),
    ...overrides,
  };
}

test('validates UUID and safe caller filename', () => {
  assert.equal(parseSummaryId(SUMMARY_ID), SUMMARY_ID);
  assert.equal(parseFileName('Client Summary.pdf'), 'Client Summary.pdf');
  assert.throws(() => parseSummaryId('../bad'), (error) => error.code === 'VALIDATION_ERROR');
  assert.throws(() => parseFileName('..\\secret.pdf'), (error) => error.code === 'VALIDATION_ERROR');
  assert.throws(() => parseFileName('bad/name.pdf'), (error) => error.code === 'VALIDATION_ERROR');
});

test('upload validation rejects wrong content type and oversized body', async () => {
  await assert.rejects(
    runUploadValidation(requestFixture({ headers: { 'content-type': 'text/plain' } })),
    (error) => error.code === 'GENERATED_REPORT_CONTENT_TYPE_INVALID',
  );
  await assert.rejects(
    runUploadValidation(requestFixture({ headers: { 'content-length': '2048' } }), 1024),
    (error) => error.code === 'GENERATED_REPORT_TOO_LARGE',
  );
});

test('deterministic location stays under generated report root', () => {
  const location = buildReportLocation('C:\\reports', 29, 2025, SUMMARY_ID);
  assert.equal(location.relativeFilePath, `29\\2025\\${SUMMARY_ID}.pdf`);
  assert.equal(location.finalPath, `C:\\reports\\29\\2025\\${SUMMARY_ID}.pdf`);
});

test('valid PDF is streamed to staging, renamed, and retrievable', async (t) => {
  const { root, storage } = await storageFixture(t);
  const pdf = Buffer.from('%PDF-1.7\nvalid report');
  const values = valuesFor(pdf);
  const result = await storage.persist(values, Readable.from(pdf));

  assert.equal(result.relativeFilePath, `29\\2025\\${SUMMARY_ID}.pdf`);
  assert.equal(result.fileSize, pdf.length);
  assert.equal(result.fileHash, values.expectedHash);
  assert.equal(result.idempotent, false);
  assert.equal(JSON.stringify(result).includes(root), false);

  const prepared = await storage.prepare(values);
  const received = [];
  for await (const chunk of prepared.createReadStream()) received.push(chunk);
  assert.deepEqual(Buffer.concat(received), pdf);

  const entries = await fsp.readdir(path.join(root, '29', '2025'));
  assert.deepEqual(entries, [`${SUMMARY_ID}.pdf`]);
});

test('non-PDF and wrong hash uploads remove staging files', async (t) => {
  const { root, storage } = await storageFixture(t);
  const notPdf = Buffer.from('plain text');
  await assert.rejects(
    storage.persist(valuesFor(notPdf), Readable.from(notPdf)),
    (error) => error.code === 'GENERATED_REPORT_INVALID_PDF',
  );

  const pdf = Buffer.from('%PDF-1.7\nwrong hash');
  await assert.rejects(
    storage.persist(valuesFor(pdf, { expectedHash: '0'.repeat(64) }), Readable.from(pdf)),
    (error) => error.code === 'GENERATED_REPORT_HASH_MISMATCH',
  );

  const directory = path.join(root, '29', '2025');
  const entries = await fsp.readdir(directory).catch(() => []);
  assert.equal(entries.some((name) => name.endsWith('.staging')), false);
  assert.equal(entries.some((name) => name.endsWith('.pdf')), false);
});

test('same-hash retry is idempotent and different content is rejected', async (t) => {
  const { storage } = await storageFixture(t);
  const first = Buffer.from('%PDF-1.7\nfirst report');
  const firstValues = valuesFor(first);
  await storage.persist(firstValues, Readable.from(first));

  const retry = await storage.persist(firstValues, Readable.from(first));
  assert.equal(retry.idempotent, true);

  const different = Buffer.from('%PDF-1.7\ndifferent report');
  await assert.rejects(
    storage.persist(valuesFor(different), Readable.from(different)),
    (error) => error.code === 'GENERATED_REPORT_ALREADY_EXISTS' && error.status === 409,
  );
});

test('missing report returns safe 404 without physical path', async (t) => {
  const { root, storage } = await storageFixture(t);
  await assert.rejects(
    storage.prepare(valuesFor(Buffer.from('%PDF-x'))),
    (error) => error.code === 'GENERATED_REPORT_NOT_FOUND'
      && error.status === 404
      && !error.message.includes(root),
  );
});

test('declared length mismatch is rejected and staging is cleaned', async (t) => {
  const { root, storage } = await storageFixture(t);
  const pdf = Buffer.from('%PDF-1.7\nlength mismatch');
  await assert.rejects(
    storage.persist(valuesFor(pdf, { contentLength: pdf.length + 1 }), Readable.from(pdf)),
    (error) => error.code === 'GENERATED_REPORT_LENGTH_MISMATCH',
  );
  const directory = path.join(root, '29', '2025');
  const entries = await fsp.readdir(directory).catch(() => []);
  assert.equal(entries.some((name) => name.includes('.staging')), false);
});

test('final file is a regular file and no symbolic link is accepted', async (t) => {
  const { root, storage } = await storageFixture(t);
  const location = storage.buildLocation({ summaryId: SUMMARY_ID, clientId: 29, currentYear: 2025 });
  await fsp.mkdir(path.dirname(location.finalPath), { recursive: true });
  if (process.platform !== 'win32') {
    const target = path.join(root, 'target.pdf');
    await fsp.writeFile(target, '%PDF-target');
    await fsp.symlink(target, location.finalPath);
    await assert.rejects(
      storage.prepare({ summaryId: SUMMARY_ID, clientId: 29, currentYear: 2025 }),
      (error) => error.code === 'GENERATED_REPORT_NOT_FOUND',
    );
  } else {
    assert.equal(fs.existsSync(location.finalPath), false);
  }
});