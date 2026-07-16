const path = require('path');
const { createHttpError } = require('../../utils/httpError');
const { downloadFileName } = require('../../utils/filenames');
const { createZipWriter, uniqueArchiveName } = require('../../utils/zip');

function numberField(record, names) {
  for (const name of names) {
    if (record && record[name] !== undefined && record[name] !== null) return Number(record[name]);
  }
  const lowered = new Map(Object.keys(record || {}).map((key) => [key.toLowerCase(), key]));
  for (const name of names) {
    const key = lowered.get(name.toLowerCase());
    if (key) return Number(record[key]);
  }
  return NaN;
}

function createArchivesService({ config, repository, storage, queue, logger, archiveFactory, zipWriterFactory = createZipWriter }) {
  async function buildArchive({ requestId, signal, rowsProvider }) {
    const release = await queue.acquire({ signal });
    let workDir;
    try {
      await storage.ensureDiskReserve();
      workDir = await storage.createWorkDirectory(requestId);
      const zipPath = path.join(workDir, 'archive.zip');
      const output = storage.createWriteStream(zipPath);
      const writer = zipWriterFactory({
        output,
        archiveFactory,
        idleTimeoutMs: config.zip.idleTimeoutMs,
        signal,
      });
      const usedNames = new Set();
      const failures = [];
      let successful = 0;
      let processed = 0;

      for await (const item of rowsProvider()) {
        if (signal?.aborted) throw createHttpError(499, 'Archive request was cancelled.', 'REQUEST_CANCELLED');
        processed += 1;
        if (processed === 1 || processed % config.zip.queryPageSize === 0) {
          await storage.ensureDiskReserve();
        }
        try {
          const prepared = await storage.prepareSource(item.sourceRecord);
          const archiveName = uniqueArchiveName(downloadFileName(item.documentRecord), usedNames);
          writer.appendFile(prepared.filePath, archiveName);
          successful += 1;
        } catch (error) {
          failures.push({
            documentId: Number(item.documentRecord.DocumentID),
            fileName: downloadFileName(item.documentRecord),
            code: error && error.code ? error.code : 'DOCUMENT_FILE_NOT_FOUND',
            message: 'The source file was not available.',
          });
        }
      }

      if (successful === 0) {
        throw createHttpError(400, 'No documents are available to zip.', 'DOCUMENT_ZIP_EMPTY');
      }

      if (failures.length > 0) {
        writer.appendJson({
          generatedAt: new Date().toISOString(),
          failedCount: failures.length,
          failures,
        }, 'failed-documents.json');
      }

      await writer.finalize();
      const stat = await storage.stat(zipPath);
      logger.info('archive_created', {
        requestId,
        operation: 'archive.create',
        successfulDocuments: successful,
        failedDocuments: failures.length,
        bytes: stat.size,
      });
      return {
        filePath: zipPath,
        size: stat.size,
        successfulDocuments: successful,
        failedDocuments: failures.length,
        cleanupPath: workDir,
      };
    } catch (error) {
      await storage.cleanup(workDir);
      throw error;
    } finally {
      release();
    }
  }

  async function selectedRowsProvider(filters, dbCredentials) {
    const pageSize = config.zip.queryPageSize;
    const documents = [];
    for (let index = 0; index < filters.documentIds.length; index += pageSize) {
      const ids = filters.documentIds.slice(index, index + pageSize);
      documents.push(...await repository.findSelectedDocuments(filters.clientId, ids, dbCredentials));
    }
    const found = new Set(documents.map((row) => Number(row.DocumentID)));
    const missing = filters.documentIds.filter((id) => !found.has(Number(id)));
    if (missing.length > 0) {
      throw createHttpError(404, 'One or more documents were not found for this client.', 'DOCUMENT_NOT_FOUND');
    }

    const sourceRows = [];
    for (let index = 0; index < filters.documentIds.length; index += pageSize) {
      const ids = filters.documentIds.slice(index, index + pageSize);
      sourceRows.push(...await repository.findSourcePaths(filters.clientId, ids, dbCredentials));
    }
    const sourceMap = new Map(sourceRows.map((row) => [numberField(row, ['DocumentID']), row]));
    const documentMap = new Map(documents.map((row) => [Number(row.DocumentID), row]));

    return async function* provider() {
      for (const id of filters.documentIds) {
        yield {
          documentRecord: documentMap.get(Number(id)),
          sourceRecord: sourceMap.get(Number(id)) || {},
        };
      }
    };
  }

  function queryRowsProvider(filters, dbCredentials) {
    return async function* provider() {
      const pageSize = config.zip.queryPageSize;
      const startOffset = filters.offset || 0;
      let emitted = 0;
      for (let pageOffset = startOffset; ; pageOffset += pageSize) {
        const remaining = filters.limit === undefined ? pageSize : Math.min(pageSize, filters.limit - emitted);
        if (remaining <= 0) break;
        const documents = await repository.findDocumentPage({
          clientId: filters.clientId,
          filters: filters.filters,
          sortSql: filters.sortSql,
          offset: pageOffset,
          limit: remaining,
        }, dbCredentials);
        if (!documents.length) break;
        const ids = documents.map((row) => Number(row.DocumentID));
        const sourceRows = await repository.findSourcePaths(filters.clientId, ids, dbCredentials);
        const sourceMap = new Map(sourceRows.map((row) => [numberField(row, ['DocumentID']), row]));
        for (const documentRecord of documents) {
          yield {
            documentRecord,
            sourceRecord: sourceMap.get(Number(documentRecord.DocumentID)) || {},
          };
          emitted += 1;
        }
        if (documents.length < remaining) break;
      }
    };
  }

  return {
    async createSelectedArchive(filters, context) {
      const provider = await selectedRowsProvider(filters, context.dbCredentials);
      return buildArchive({ ...context, rowsProvider: provider });
    },
    createQueryArchive(filters, context) {
      return buildArchive({ ...context, rowsProvider: queryRowsProvider(filters, context.dbCredentials) });
    },
    async cleanup(descriptor) {
      await storage.cleanup(descriptor && descriptor.cleanupPath);
    },
  };
}

module.exports = { createArchivesService, numberField };
