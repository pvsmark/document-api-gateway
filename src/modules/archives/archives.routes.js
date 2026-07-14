const express = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const { BoundedSemaphore } = require('../../utils/semaphore');
const { createArchivesRepository } = require('./archives.repository');
const { createArchivesStorage } = require('./archives.storage');
const { createArchivesService } = require('./archives.service');
const { createArchivesController } = require('./archives.controller');
const { validateQueryArchive, validateSelectedArchive } = require('./archives.validation');

function createArchivesModule(options) {
  const router = express.Router();
  const queue = options.queue || new BoundedSemaphore({
    concurrency: options.config.zip.concurrency,
    maxQueueLength: options.config.zip.maxQueueLength,
    queueTimeoutMs: options.config.zip.queueTimeoutMs,
  });
  const repository = options.repository || createArchivesRepository(options.database);
  const storage = options.storage || createArchivesStorage(options.config);
  const service = options.service || createArchivesService({
    config: options.config,
    repository,
    storage,
    queue,
    logger: options.logger,
  });
  const controller = createArchivesController({ service, logger: options.logger });

  router.post('/selected', validateSelectedArchive, asyncHandler(controller.selected));
  router.post('/query', validateQueryArchive, asyncHandler(controller.query));

  return { router, queue, service };
}

module.exports = { createArchivesModule };
