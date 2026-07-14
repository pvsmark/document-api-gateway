const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { BoundedSemaphore } = require('../src/utils/semaphore');
const { createZipWriter, uniqueArchiveName } = require('../src/utils/zip');
const { createArchivesService } = require('../src/modules/archives/archives.service');
const { validateSelectedArchive, validateQueryArchive } = require('../src/modules/archives/archives.validation');

function runValidation(middleware, body) {
  return new Promise((resolve, reject) => {
    const req = { body };
    middleware(req, {}, (error) => (error ? reject(error) : resolve(req.validated)));
  });
}

function fakeZipWriterFactory(records) {
  return () => ({
    appendFile(filePath, archiveName) { records.files.push({ filePath, archiveName }); },
    appendJson(value, archiveName) { records.json.push({ value, archiveName }); },
    async finalize() { records.finalized += 1; },
  });
}

function serviceFixture(overrides = {}) {
  const records = { files: [], json: [], finalized: 0, cleanup: [] };
  const config = { zip: { queryPageSize: 2, idleTimeoutMs: 1000 } };
  const storage = {
    async ensureDiskReserve() {},
    async createWorkDirectory() { return '/safe/temp/pvs-archive-test'; },
    createWriteStream() { return new PassThrough(); },
    async prepareSource(sourceRecord) {
      if (sourceRecord.missing) { const error = new Error('hidden'); error.code = 'DOCUMENT_FILE_NOT_FOUND'; throw error; }
      return { filePath: `/safe/${sourceRecord.DocumentID}.pdf`, size: 10 };
    },
    async stat() { return { size: 123 }; },
    async cleanup(value) { records.cleanup.push(value); },
    ...overrides.storage,
  };
  const queue = overrides.queue || new BoundedSemaphore({ concurrency: 1, maxQueueLength: 5, queueTimeoutMs: 100 });
  const service = createArchivesService({
    config,
    repository: overrides.repository,
    storage,
    queue,
    logger: { info() {}, error() {}, warn() {} },
    zipWriterFactory: fakeZipWriterFactory(records),
  });
  return { service, records, queue };
}

test('selected validation deduplicates IDs', async () => {
  const value = await runValidation(validateSelectedArchive, { clientId: 29, documentIds: [1, 1, 2] });
  assert.deepEqual(value.documentIds, [1, 2]);
});

test('query without offset and limit represents ZIP All', async () => {
  const value = await runValidation(validateQueryArchive, { clientId: 29, filters: {} });
  assert.equal(value.offset, undefined);
  assert.equal(value.limit, undefined);
});

test('duplicate names are renamed', () => {
  const used = new Set();
  assert.equal(uniqueArchiveName('Document.pdf', used), 'files/Document.pdf');
  assert.equal(uniqueArchiveName('Document.pdf', used), 'files/Document (2).pdf');
});

test('more than 65,535 synthetic names are representable', () => {
  const used = new Set();
  for (let index = 0; index < 65536; index += 1) uniqueArchiveName(`Document-${index}.pdf`, used);
  assert.equal(used.size, 65536);
});

test('ZIP writer forces ZIP64', async () => {
  let options;
  const output = new PassThrough();
  class FakeArchive extends EventEmitter { pipe() {} append() {} async finalize() { output.emit('close'); } abort() {} }
  const writer = createZipWriter({ output, archiveFactory: (format, supplied) => { options = supplied; return new FakeArchive(); }, idleTimeoutMs: 1000 });
  await writer.finalize();
  assert.equal(options.forceZip64, true);
  assert.equal(options.store, true);
});

test('queue full and timeout are enforced', async () => {
  const queue = new BoundedSemaphore({ concurrency: 1, maxQueueLength: 1, queueTimeoutMs: 10 });
  const release = await queue.acquire();
  const waiting = queue.acquire();
  await assert.rejects(queue.acquire(), (error) => error.code === 'ZIP_QUEUE_FULL');
  await assert.rejects(waiting, (error) => error.code === 'ZIP_QUEUE_TIMEOUT');
  release();
});

test('unauthorized selected ID rejects whole request', async () => {
  const fixture = serviceFixture({ repository: {
    async findSelectedDocuments() { return [{ DocumentID: 1, FileName: 'one.pdf', Ext: 'pdf' }]; },
    async findSourcePaths() { throw new Error('must not be called'); },
  } });
  await assert.rejects(
    fixture.service.createSelectedArchive({ clientId: 29, documentIds: [1, 2] }, { requestId: 'test', signal: new AbortController().signal }),
    (error) => error.code === 'DOCUMENT_NOT_FOUND',
  );
});

test('query ZIP pages through records', async () => {
  const offsets = [];
  const fixture = serviceFixture({ repository: {
    async findDocumentPage({ offset }) { offsets.push(offset); return offset === 0 ? [{ DocumentID: 1, FileName: 'one.pdf', Ext: 'pdf' }, { DocumentID: 2, FileName: 'two.pdf', Ext: 'pdf' }] : offset === 2 ? [{ DocumentID: 3, FileName: 'three.pdf', Ext: 'pdf' }] : []; },
    async findSourcePaths(clientId, ids) { return ids.map((DocumentID) => ({ DocumentID })); },
  } });
  const descriptor = await fixture.service.createQueryArchive({ clientId: 29, filters: {}, sortSql: 'documents.DocumentID ASC' }, { requestId: 'test', signal: new AbortController().signal });
  assert.deepEqual(offsets, [0, 2]);
  assert.equal(descriptor.successfulDocuments, 3);
});

test('missing file adds safe failure report', async () => {
  const fixture = serviceFixture({ repository: {
    async findDocumentPage({ offset }) { return offset === 0 ? [{ DocumentID: 1, FileName: 'one.pdf', Ext: 'pdf' }, { DocumentID: 2, FileName: 'two.pdf', Ext: 'pdf' }] : []; },
    async findSourcePaths() { return [{ DocumentID: 1 }, { DocumentID: 2, missing: true }]; },
  } });
  const descriptor = await fixture.service.createQueryArchive({ clientId: 29, filters: {}, sortSql: 'documents.DocumentID ASC' }, { requestId: 'test', signal: new AbortController().signal });
  assert.equal(descriptor.failedDocuments, 1);
  assert.equal(fixture.records.json[0].archiveName, 'failed-documents.json');
  assert.equal(JSON.stringify(fixture.records.json).includes('\\\\fs2'), false);
});

test('all missing returns empty and cleans temp', async () => {
  const fixture = serviceFixture({ repository: {
    async findDocumentPage({ offset }) { return offset === 0 ? [{ DocumentID: 1, FileName: 'one.pdf', Ext: 'pdf' }] : []; },
    async findSourcePaths() { return [{ DocumentID: 1, missing: true }]; },
  } });
  await assert.rejects(fixture.service.createQueryArchive({ clientId: 29, filters: {}, sortSql: 'documents.DocumentID ASC' }, { requestId: 'test', signal: new AbortController().signal }), (error) => error.code === 'DOCUMENT_ZIP_EMPTY');
  assert.deepEqual(fixture.records.cleanup, ['/safe/temp/pvs-archive-test']);
});

test('disk reserve failure stops safely', async () => {
  let created = false;
  const fixture = serviceFixture({
    storage: { async ensureDiskReserve() { const error = new Error('low'); error.code = 'ZIP_DISK_RESERVE_LOW'; throw error; }, async createWorkDirectory() { created = true; } },
    repository: { async findDocumentPage() { return []; }, async findSourcePaths() { return []; } },
  });
  await assert.rejects(fixture.service.createQueryArchive({ clientId: 29, filters: {}, sortSql: 'documents.DocumentID ASC' }, { requestId: 'test', signal: new AbortController().signal }), (error) => error.code === 'ZIP_DISK_RESERVE_LOW');
  assert.equal(created, false);
});
