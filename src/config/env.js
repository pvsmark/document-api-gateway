const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function requireValue(name, value) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`${name} is required.`);
  return result;
}

function positiveInteger(name, value, fallback) {
  const parsed = Number.parseInt(value || fallback, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function loadConfig(source = process.env) {
  const keys = JSON.parse(requireValue('SERVICE_AUTH_KEYS_JSON', source.SERVICE_AUTH_KEYS_JSON));
  for (const [keyId, secret] of Object.entries(keys)) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId) || String(secret).length < 32) {
      throw new Error('Service key IDs must be valid and secrets must contain at least 32 characters.');
    }
  }

  const sourceRoot = requireValue('DOCUMENT_SOURCE_ROOT', source.DOCUMENT_SOURCE_ROOT).replace(/\//g, '\\');
  const reportRoot = requireValue('GENERATED_REPORT_ROOT', source.GENERATED_REPORT_ROOT).replace(/\//g, '\\');
  if (!path.win32.isAbsolute(sourceRoot) || !path.win32.isAbsolute(reportRoot)) {
    throw new Error('Storage roots must be absolute Windows paths.');
  }

  const tempRoot = path.resolve(PROJECT_ROOT, source.DOCUMENT_TEMP_ROOT || './temp');
  const relativeTemp = path.relative(PROJECT_ROOT, tempRoot);
  if (relativeTemp === '..' || relativeTemp.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTemp)) {
    throw new Error('DOCUMENT_TEMP_ROOT must remain inside the project root.');
  }

  const allowedCallerIps = requireValue('ALLOWED_CALLER_IPS', source.ALLOWED_CALLER_IPS)
    .split(',').map((value) => value.trim()).filter(Boolean);

  return {
    projectRoot: PROJECT_ROOT,
    nodeEnv: source.NODE_ENV || 'development',
    isProduction: source.NODE_ENV === 'production',
    host: source.HOST || '127.0.0.1',
    port: positiveInteger('PORT', source.PORT, 3100),
    allowedCallerIps,
    serviceAuth: {
      keys,
      maxClockSkewSeconds: positiveInteger('SERVICE_AUTH_MAX_CLOCK_SKEW_SECONDS', source.SERVICE_AUTH_MAX_CLOCK_SKEW_SECONDS, 120),
      nonceTtlSeconds: positiveInteger('SERVICE_AUTH_NONCE_TTL_SECONDS', source.SERVICE_AUTH_NONCE_TTL_SECONDS, 300),
      maxNonces: positiveInteger('SERVICE_AUTH_MAX_NONCES', source.SERVICE_AUTH_MAX_NONCES, 10000),
    },
    db: {
      dsn: requireValue('DB_DSN', source.DB_DSN),
      uid: requireValue('DB_UID', source.DB_UID),
      pwd: requireValue('DB_PWD', source.DB_PWD),
      loginTimeoutSeconds: positiveInteger('DB_LOGIN_TIMEOUT_SECONDS', source.DB_LOGIN_TIMEOUT_SECONDS, 15),
      connectionTimeoutSeconds: positiveInteger('DB_CONNECTION_TIMEOUT_SECONDS', source.DB_CONNECTION_TIMEOUT_SECONDS, 60),
      queryTimeoutSeconds: positiveInteger('DB_QUERY_TIMEOUT_SECONDS', source.DB_QUERY_TIMEOUT_SECONDS, 60),
      poolEnabled: String(source.DB_POOL_ENABLED || 'true').toLowerCase() !== 'false',
      poolInitialSize: positiveInteger('DB_POOL_INITIAL_SIZE', source.DB_POOL_INITIAL_SIZE, 1),
      poolIncrementSize: positiveInteger('DB_POOL_INCREMENT_SIZE', source.DB_POOL_INCREMENT_SIZE, 1),
      poolMaxSize: positiveInteger('DB_POOL_MAX_SIZE', source.DB_POOL_MAX_SIZE, 3),
    },
    storage: {
      documentSourceRoot: path.win32.normalize(sourceRoot),
      generatedReportRoot: path.win32.normalize(reportRoot),
      tempRoot,
    },
    shutdownTimeoutMs: positiveInteger('SHUTDOWN_TIMEOUT_MS', source.SHUTDOWN_TIMEOUT_MS, 30000),
    staleTempMaxAgeHours: positiveInteger('STALE_TEMP_MAX_AGE_HOURS', source.STALE_TEMP_MAX_AGE_HOURS, 24),
    logLevel: source.LOG_LEVEL || 'info',
  };
}

module.exports = Object.freeze({ ...loadConfig(), loadConfig, PROJECT_ROOT });
