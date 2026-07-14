const express = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const { createGeneratedReportsStorage } = require('./generatedReports.storage');
const { createGeneratedReportsService } = require('./generatedReports.service');
const { createGeneratedReportsController } = require('./generatedReports.controller');
const {
  validateGeneratedReportRetrieval,
  validateGeneratedReportUpload,
} = require('./generatedReports.validation');

function createGeneratedReportsRouter(options) {
  const router = express.Router();
  const storage = options.storage || createGeneratedReportsStorage(options.config);
  const service = options.service || createGeneratedReportsService({ storage });
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

  return { router, service, storage };
}

module.exports = { createGeneratedReportsRouter };