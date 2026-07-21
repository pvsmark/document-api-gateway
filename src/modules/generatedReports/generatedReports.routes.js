const express = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const { createGeneratedReportsRepository } = require('./generatedReports.repository');
const { createGeneratedReportsStorage } = require('./generatedReports.storage');
const { createGeneratedReportsService } = require('./generatedReports.service');
const { createGeneratedReportsController } = require('./generatedReports.controller');
const {
  validateGeneratedReportRetrieval,
  validateGeneratedReportUpload,
} = require('./generatedReports.validation');

// AI_SUMMARY_DOCUMENT_LINK_PATCH_V1
function createGeneratedReportsRouter(options) {
  const router = express.Router();
  const repository = options.repository
    || (options.service ? null : createGeneratedReportsRepository(options.database));
  const storage = options.storage || createGeneratedReportsStorage(options.config);
  const service = options.service || createGeneratedReportsService({ repository, storage });
  const controller = createGeneratedReportsController({ service, logger: options.logger });

  router.put(
    '/:summaryId',
    validateGeneratedReportUpload(options.config),
    asyncHandler(controller.upload),
  );
  router.get(
    '/:summaryId',
    validateGeneratedReportRetrieval,
    asyncHandler(controller.retrieve),
  );

  return { router, repository, service, storage };
}

module.exports = { createGeneratedReportsRouter };
