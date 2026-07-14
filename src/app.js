const express = require('express');
const { createDatabase } = require('./db/odbc');
const { requestIdMiddleware } = require('./middleware/requestId.middleware');
const { createIpAllowlistMiddleware } = require('./middleware/ipAllowlist.middleware');
const { createServiceAuthMiddleware } = require('./middleware/serviceAuth.middleware');
const { createErrorHandler, notFound } = require('./middleware/error.middleware');
const { createRequestLoggingMiddleware } = require('./middleware/requestLogging.middleware');
const asyncHandler = require('./utils/asyncHandler');
const { createHttpError } = require('./utils/httpError');
const { createLogger } = require('./utils/logger');
const { assertDirectoryReadable, assertDirectoryWritable } = require('./utils/temp');

function createApp(options = {}) {
  const config = options.config || require('./config/env');
  const logger = options.logger || createLogger(config.logLevel);
  const database = options.database || createDatabase(config, logger);
  const readinessCheck = options.readinessCheck || (async () => {
    const result = {
      database: 'unavailable',
      sourceStorage: 'unavailable',
      generatedStorage: 'unavailable',
      temporaryStorage: 'unavailable',
    };
    await Promise.all([
      database.checkHealth().then(() => { result.database = 'ok'; }).catch(() => undefined),
      assertDirectoryReadable(config.storage.documentSourceRoot).then(() => { result.sourceStorage = 'ok'; }).catch(() => undefined),
      assertDirectoryReadable(config.storage.generatedReportRoot).then(() => { result.generatedStorage = 'ok'; }).catch(() => undefined),
      assertDirectoryWritable(config.storage.tempRoot).then(() => { result.temporaryStorage = 'ok'; }).catch(() => undefined),
    ]);
    return result;
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.locals.config = config;
  app.locals.logger = logger;
  app.locals.database = database;
  app.locals.isShuttingDown = false;

  app.use(requestIdMiddleware);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  });
  app.use(createRequestLoggingMiddleware(logger));

  app.get('/health/live', (req, res) => res.json({
    status: 'ok',
    service: 'pvs-document-api',
    uptimeSeconds: Math.floor(process.uptime()),
  }));

  app.get('/health/ready', asyncHandler(async (req, res) => {
    const checks = await readinessCheck();
    const ready = Object.values(checks).every((value) => value === 'ok');
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable', ...checks });
  }));

  const v1 = express.Router();
  v1.use(createIpAllowlistMiddleware(config));
  v1.use(express.json({
    limit: '256kb',
    verify(req, res, buffer) { req.rawBody = Buffer.from(buffer); },
  }));
  v1.use(createServiceAuthMiddleware(config, options));
  v1.use((req, res, next) => {
    if (app.locals.isShuttingDown) return next(createHttpError(503, 'Service is shutting down.', 'SERVICE_SHUTTING_DOWN'));
    return next();
  });

  if (typeof options.configureV1Routes === 'function') options.configureV1Routes(v1);
  app.use('/v1', v1);
  app.use(notFound);
  app.use(createErrorHandler(config, logger));
  return app;
}

module.exports = { createApp };
