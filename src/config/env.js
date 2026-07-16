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

// PHASE6_OPTION_A_CONFIG
function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function optionalBase64Key(name, value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const key = Buffer.from(text, 'base64');
  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== text.replace(/=+$/, '')) {
    throw new Error(`${name} must be a base64-encoded 32-byte key.`);
  }
  return key;
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
  const delegatedDbContextEnabled = parseBoolean(source.DELEGATED_DB_CONTEXT_ENABLED, false);
  const delegatedDbContextKey = optionalBase64Key(
    'DELEGATED_DB_CONTEXT_KEY',
    source.DELEGATED_DB_CONTEXT_KEY,
  );
  if (delegatedDbContextEnabled && !delegatedDbContextKey) {
    throw new Error('DELEGATED_DB_CONTEXT_KEY is required when delegated database context is enabled.');
  }

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
    delegatedDbContext: {
      enabled: delegatedDbContextEnabled,
      key: delegatedDbContextKey,
      maxTtlSeconds: positiveInteger('DELEGATED_DB_CONTEXT_MAX_TTL_SECONDS', source.DELEGATED_DB_CONTEXT_MAX_TTL_SECONDS, 120),
      maxClockSkewSeconds: positiveInteger('DELEGATED_DB_CONTEXT_MAX_CLOCK_SKEW_SECONDS', source.DELEGATED_DB_CONTEXT_MAX_CLOCK_SKEW_SECONDS, 30),
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
      userPoolMaxCredentialPools: positiveInteger('DB_USER_POOL_MAX_CREDENTIAL_POOLS', source.DB_USER_POOL_MAX_CREDENTIAL_POOLS, 20),
      userPoolIdleTimeoutMs: positiveInteger('DB_USER_POOL_IDLE_TIMEOUT_MS', source.DB_USER_POOL_IDLE_TIMEOUT_MS, 300000),
      connectionAuthentication: String(source.DB_CONNECTION_AUTHENTICATION || ''),
    },
    storage: {
      documentSourceRoot: path.win32.normalize(sourceRoot),
      generatedReportRoot: path.win32.normalize(reportRoot),
      tempRoot,
    },
    zip: {
      concurrency: positiveInteger('ZIP_CONCURRENCY', source.ZIP_CONCURRENCY, 1),
      maxQueueLength: positiveInteger('ZIP_MAX_QUEUE_LENGTH', source.ZIP_MAX_QUEUE_LENGTH, 5),
      queueTimeoutMs: positiveInteger('ZIP_QUEUE_TIMEOUT_MS', source.ZIP_QUEUE_TIMEOUT_MS, 30000),
      idleTimeoutMs: positiveInteger('ZIP_IDLE_TIMEOUT_MS', source.ZIP_IDLE_TIMEOUT_MS, 120000),
      minFreeDiskBytes: positiveInteger('ZIP_MIN_FREE_DISK_BYTES', source.ZIP_MIN_FREE_DISK_BYTES, 5368709120),
      queryPageSize: positiveInteger('ZIP_QUERY_PAGE_SIZE', source.ZIP_QUERY_PAGE_SIZE, 100),
    },
    generatedReports: {
      maxBytes: positiveInteger('GENERATED_REPORT_MAX_BYTES', source.GENERATED_REPORT_MAX_BYTES, 26214400),
    },
    shutdownTimeoutMs: positiveInteger('SHUTDOWN_TIMEOUT_MS', source.SHUTDOWN_TIMEOUT_MS, 30000),
    staleTempMaxAgeHours: positiveInteger('STALE_TEMP_MAX_AGE_HOURS', source.STALE_TEMP_MAX_AGE_HOURS, 24),
    logLevel: source.LOG_LEVEL || 'info',
  };
}

module.exports = Object.freeze({ ...loadConfig(), loadConfig, PROJECT_ROOT });
