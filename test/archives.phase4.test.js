const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');
const { buildFilters, createArchivesRepository } = require('../src/modules/archives/archives.repository');
const { createArchivesService } = require('../src/modules/archives/archives.service');
const {
  FILTER_NAMES,
  SORTS,
  parseFilters,
  validateQueryArchive,
} = require('../src/modules/archives/archives.validation');

function runValidation(body) {
  return new Promise((resolve, reject) => {
    const req = { body };
    validateQueryArchive(req, {}, (error) => (error ? reject(error) : resolve(req.validated)));
  });
}

function fakeWriter(records) {
  return () => ({
    appendFile(filePath, archiveName) { records.files.push({ filePath, archiveName }); },
    appendJson(value, archiveName) { records.json.push({ value, archiveName }); },
    async finalize() {},
  });
}

function serviceFixture(repository, pageSize = 2) {
  const records = { files: [], json: [] };
  const service = createArchivesService({
    config: { zip: { queryPageSize: pageSize, idleTimeoutMs: 1000 } },
    repository,
    storage: {
      async ensureDiskReserve() {},
      async createWorkDirectory() { return '/safe/temp/pvs-archive-phase4'; },
      createWriteStream() { return new PassThrough(); },
      async prepareSource(source) { return { filePath: `/safe/${source.DocumentID}.pdf` }; },
      async stat() { return { size: 100 }; },
      async cleanup() {},
    },
    queue: { async acquire() { return () => {}; } },
    logger: { info() {}, warn() {}, error() {} },
    zipWriterFactory: fakeWriter(records),
  });
  return { service, records };
}

test('supported filter names match the main backend contract', () => {
  assert.deepEqual(FILTER_NAMES, [
    'search', 'property', 'parcel', 'account', 'state', 'sysYear',
    'documentType', 'ownerName', 'assessor', 'locationCode',
    'propMasterId', 'collectorId',
  ]);
});

test('every supported filter is parsed', () => {
  const parsed = parseFilters({
    search: 'needle',
    property: 'P-1',
    parcel: 'PAR',
    account: 'ACCT',
    state: 'tx',
    sysYear: 2025,
    documentType: 'Tax Bill',
    ownerName: 'Owner',
    assessor: 'Assessor',
    locationCode: 'LOC',
    propMasterId: '123',
    collectorId: 45,
  });
  assert.equal(parsed.state, 'TX');
  assert.equal(parsed.sysYear, 2025);
  assert.equal(parsed.collectorId, 45);
  assert.equal(Object.values(parsed).filter((value) => value !== undefined).length, 12);
});

test('unknown filters are rejected', async () => {
  await assert.rejects(
    runValidation({ clientId: 29, filters: { arbitrarySql: 'DROP TABLE X' } }),
    (error) => error.code === 'VALIDATION_ERROR',
  );
});

test('approved ascending and descending sorts are accepted', async () => {
  for (const sort of Object.keys(SORTS)) {
    const validated = await runValidation({ clientId: 29, filters: {}, sort });
    assert.equal(validated.sortSql, SORTS[sort]);
    assert.match(validated.sortSql, /documents\.DocumentID/);
  }
});

test('unknown sort is rejected', async () => {
  await assert.rejects(
    runValidation({ clientId: 29, filters: {}, sort: 'DocumentID; DROP TABLE X' }),
    (error) => error.code === 'VALIDATION_ERROR',
  );
});

test('offset and limit select batch mode and must be paired', async () => {
  const all = await runValidation({ clientId: 29, filters: {} });
  assert.equal(all.mode, 'all');
  assert.equal(all.offset, undefined);
  assert.equal(all.limit, undefined);

  const batch = await runValidation({ clientId: 29, filters: {}, offset: 50, limit: 25 });
  assert.equal(batch.mode, 'batch');
  assert.equal(batch.offset, 50);
  assert.equal(batch.limit, 25);

  await assert.rejects(
    runValidation({ clientId: 29, filters: {}, offset: 0 }),
    (error) => error.code === 'VALIDATION_ERROR',
  );
});

test('LIKE metacharacters are escaped and remain SQL parameters', () => {
  const filters = parseFilters({ search: "x%' OR 1=1 --", ownerName: 'A_B[Z]' });
  const built = buildFilters(29, filters);
  assert.equal(built.params[0], 29);
  assert.ok(built.params.some((value) => String(value).includes("OR 1=1")));
  assert.ok(built.params.some((value) => String(value).includes('[%]')));
  assert.ok(built.params.some((value) => String(value).includes('[_]')));
  assert.ok(built.params.some((value) => String(value).includes('[[]')));
  assert.equal(built.where.includes('OR 1=1'), false);
  assert.match(built.where, /^documents\.ClientMasterID = \?/);
});

test('repository always client-scopes and parameterizes filtered queries', async () => {
  let captured;
  const repository = createArchivesRepository({
    async query(statement, params) {
      captured = { statement, params };
      return [];
    },
  });
  await repository.findDocumentPage({
    clientId: 29,
    filters: parseFilters({ documentType: "Tax%' OR 1=1 --", sysYear: 2025 }),
    sortSql: SORTS.documentId,
    offset: 0,
    limit: 50,
  });
  assert.match(captured.statement, /documents\.ClientMasterID = \?/);
  assert.match(captured.statement, /documents\.DocumentType LIKE \?/);
  assert.equal(captured.statement.includes("Tax%' OR 1=1"), false);
  assert.equal(captured.params[0], 29);
  assert.equal(captured.params.at(-1), 2025);
});

test('ZIP All pages incrementally without retaining prior pages', async () => {
  const calls = [];
  const repository = {
    async findDocumentPage({ offset, limit }) {
      calls.push({ offset, limit });
      if (offset === 0) return [{ DocumentID: 1, FileName: '1.pdf', Ext: 'pdf' }, { DocumentID: 2, FileName: '2.pdf', Ext: 'pdf' }];
      if (offset === 2) return [{ DocumentID: 3, FileName: '3.pdf', Ext: 'pdf' }];
      return [];
    },
    async findSourcePaths(clientId, ids) { return ids.map((DocumentID) => ({ DocumentID })); },
  };
  const { service } = serviceFixture(repository, 2);
  const result = await service.createQueryArchive(
    { clientId: 29, filters: {}, sortSql: SORTS.documentId, mode: 'all' },
    { requestId: 'phase4-all', signal: new AbortController().signal },
  );
  assert.deepEqual(calls, [{ offset: 0, limit: 2 }, { offset: 2, limit: 2 }]);
  assert.equal(result.successfulDocuments, 3);
});

test('batch ZIP contains only the requested stable result window', async () => {
  const calls = [];
  const repository = {
    async findDocumentPage({ offset, limit, sortSql }) {
      calls.push({ offset, limit, sortSql });
      return [
        { DocumentID: 51, FileName: '51.pdf', Ext: 'pdf' },
        { DocumentID: 52, FileName: '52.pdf', Ext: 'pdf' },
      ];
    },
    async findSourcePaths(clientId, ids) { return ids.map((DocumentID) => ({ DocumentID })); },
  };
  const { service, records } = serviceFixture(repository, 100);
  const result = await service.createQueryArchive(
    { clientId: 29, filters: {}, sortSql: SORTS['-property'], offset: 50, limit: 2, mode: 'batch' },
    { requestId: 'phase4-batch', signal: new AbortController().signal },
  );
  assert.deepEqual(calls, [{ offset: 50, limit: 2, sortSql: SORTS['-property'] }]);
  assert.equal(result.successfulDocuments, 2);
  assert.deepEqual(records.files.map((item) => item.archiveName), ['files/51.pdf', 'files/52.pdf']);
});

test('empty filtered result returns the safe empty archive error', async () => {
  const { service } = serviceFixture({
    async findDocumentPage() { return []; },
    async findSourcePaths() { throw new Error('must not be called'); },
  });
  await assert.rejects(
    service.createQueryArchive(
      { clientId: 29, filters: {}, sortSql: SORTS.documentId, mode: 'all' },
      { requestId: 'phase4-empty', signal: new AbortController().signal },
    ),
    (error) => error.code === 'DOCUMENT_ZIP_EMPTY',
  );
});
