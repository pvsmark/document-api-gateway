const express = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const { createDocumentsRepository } = require('./documents.repository');
const { createDocumentsStorage } = require('./documents.storage');
const { createDocumentsService } = require('./documents.service');
const { createDocumentsController } = require('./documents.controller');
const { validateDocumentRequest } = require('./documents.validation');

function createDocumentsRouter(options) {
  const router = express.Router();
  const repository = options.repository || createDocumentsRepository(options.database);
  const storage = options.storage || createDocumentsStorage(options.config);
  const service = options.service || createDocumentsService({ repository, storage });
  const controller = createDocumentsController({ service, logger: options.logger });

  router.get(
    '/:documentId',
    validateDocumentRequest,
    asyncHandler(controller.streamDocument),
  );

  return router;
}

module.exports = { createDocumentsRouter };
