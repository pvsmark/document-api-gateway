const http = require('http');
const config = require('./config/env');
const { createApp } = require('./app');
const { createLogger, safeError } = require('./utils/logger');
const { ensureTempRoot, cleanupManagedTempEntries } = require('./utils/temp');

const logger = createLogger(config.logLevel);
const app = createApp({ config, logger });
const server = http.createServer(app);
let shuttingDown = false;

server.requestTimeout = 120000;
server.headersTimeout = 65000;
server.keepAliveTimeout = 5000;

async function startup() {
  await ensureTempRoot(config.storage.tempRoot);
  await cleanupManagedTempEntries(config.storage.tempRoot, {
    maxAgeMs: config.staleTempMaxAgeHours * 60 * 60 * 1000,
  });
  server.listen(config.port, config.host, () => {
    logger.info('server_started', {
      host: config.host,
      port: config.port,
      environment: config.nodeEnv,
    });
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.locals.isShuttingDown = true;
  logger.info('shutdown_started', { signal });

  const timer = setTimeout(() => {
    logger.error('shutdown_timeout', { signal });
    process.exitCode = 1;
  }, config.shutdownTimeoutMs);
  timer.unref?.();

  try {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await app.locals.database.close();
    await cleanupManagedTempEntries(config.storage.tempRoot, { maxAgeMs: 0 });
    clearTimeout(timer);
    logger.info('shutdown_completed', { signal });
  } catch (error) {
    clearTimeout(timer);
    logger.error('shutdown_failed', { signal, error: safeError(error) });
    process.exitCode = 1;
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

startup().catch((error) => {
  logger.error('startup_failed', { error: safeError(error) });
  process.exitCode = 1;
});

module.exports = { app, server, shutdown };
