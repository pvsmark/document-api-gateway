const { createHttpError } = require('../../utils/httpError');
const { contentTypeFor, downloadFileName } = require('../../utils/filenames');

function createDocumentsService({ repository, storage }) {
  return {
    async getDocument({ clientId, documentId }) {
      const documentRecord = await repository.findDocumentById(clientId, documentId);
      if (!documentRecord) {
        throw createHttpError(404, 'Document not found.', 'DOCUMENT_NOT_FOUND');
      }

      const sourceRecord = await repository.findDocumentSourcePath(documentId);
      if (!sourceRecord) {
        throw createHttpError(404, 'Document file is not available.', 'DOCUMENT_SOURCE_PATH_NOT_FOUND');
      }

      const prepared = await storage.prepareSource(sourceRecord);
      return {
        documentId: Number(documentRecord.DocumentID),
        contentType: contentTypeFor(documentRecord),
        displayName: downloadFileName(documentRecord),
        size: prepared.size,
        modifiedAt: prepared.modifiedAt,
        filePath: prepared.filePath,
        createReadStream: prepared.createReadStream,
      };
    },
  };
}

module.exports = { createDocumentsService };
