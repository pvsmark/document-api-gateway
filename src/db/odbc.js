const crypto = require('crypto');
const odbc = require('odbc');
const { createHttpError } = require('../utils/httpError');

function formatConnectionValue(value) {
  const text = String(value);
  return /[;{}]/.test(text) ? '{' + text.replace(/}/g, '}}') + '}' : text;
}

function createDatabase(config, logger) {
  let fixedPoolPromise;
  let fixedPool;
  const userPools = new Map();
  let cleanupTimer;

  function connectionConfig(credentials = config.db) {
    const parts = [
      `DSN=${formatConnectionValue(config.db.dsn)}`,
      `UID=${formatConnectionValue(credentials.uid)}`,
      `PWD=${formatConnectionValue(credentials.pwd)}`,
    ];
    return {
      connectionString: parts.join(';'),
      loginTimeout: config.db.loginTimeoutSeconds,
      connectionTimeout: config.db.connectionTimeoutSeconds,
    };
  }

  function assertCredentials(credentials) {
    if (!credentials || !credentials.uid || !credentials.pwd) {
      throw createHttpError(401, 'Delegated database credentials are invalid.', 'DB_CONTEXT_INVALID');
    }
  }

  function credentialKey(credentials) {
    return crypto
      .createHash('sha256')
      .update(config.db.dsn)
      .update('\0')
      .update(String(credentials.uid))
      .update('\0')
      .update(String(credentials.pwd))
      .digest('hex');
  }

  async function getFixedPool() {
    if (!config.db.poolEnabled || typeof odbc.pool !== 'function') return null;
    if (!fixedPoolPromise) {
      fixedPoolPromise = odbc.pool({
        ...connectionConfig(config.db),
        initialSize: config.db.poolInitialSize,
        incrementSize: config.db.poolIncrementSize,
        maxSize: config.db.poolMaxSize,
        reuseConnections: true,
      }).then((created) => {
        fixedPool = created;
        return created;
      });
    }
    return fixedPoolPromise;
  }

  async function closeUserPool(key, entry) {
    if (!entry || entry.closing) return;
    entry.closing = true;
    userPools.delete(key);
    try {
      const pool = await entry.promise;
      if (pool && typeof pool.close === 'function') await pool.close();
    } catch (error) {
      logger.warn('delegated_database_pool_close_failed', { code: error && error.code });
    }
  }

  async function ensureUserPoolCapacity() {
    if (userPools.size < config.db.userPoolMaxCredentialPools) return;
    const candidate = [...userPools.entries()]
      .filter(([, entry]) => entry.inUse === 0 && !entry.closing)
      .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)[0];
    if (!candidate) {
      throw createHttpError(503, 'Database connection capacity is busy.', 'DATABASE_POOL_BUSY');
    }
    await closeUserPool(candidate[0], candidate[1]);
  }

  async function getUserPool(credentials) {
    if (!config.db.poolEnabled || typeof odbc.pool !== 'function') return null;
    const key = credentialKey(credentials);
    let entry = userPools.get(key);
    if (!entry) {
      await ensureUserPoolCapacity();
      entry = {
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        inUse: 0,
        closing: false,
        promise: odbc.pool({
          ...connectionConfig(credentials),
          initialSize: config.db.poolInitialSize,
          incrementSize: config.db.poolIncrementSize,
          maxSize: config.db.poolMaxSize,
          reuseConnections: true,
        }),
      };
      entry.promise.catch(() => userPools.delete(key));
      userPools.set(key, entry);
    }
    entry.lastUsedAt = Date.now();
    try {
      entry.pool = await entry.promise;
      return entry;
    } catch (error) {
      userPools.delete(key);
      logger.warn('delegated_database_pool_init_failed', { code: error && error.code });
      return null;
    }
  }

  async function withConnection(callback, credentials, delegated) {
    let connection;
    let entry;
    try {
      if (delegated) {
        assertCredentials(credentials);
        entry = await getUserPool(credentials);
        if (entry) {
          connection = await entry.pool.connect();
          entry.inUse += 1;
        } else {
          connection = await odbc.connect(connectionConfig(credentials));
        }
      } else {
        const pool = await getFixedPool();
        connection = pool ? await pool.connect() : await odbc.connect(connectionConfig(config.db));
      }
      return await callback(connection);
    } catch (error) {
      logger.error('database_operation_failed', { code: error && error.code, delegated: Boolean(delegated) });
      if (error && error.status) throw error;
      throw createHttpError(503, 'Database is unavailable.', 'DATABASE_UNAVAILABLE');
    } finally {
      if (entry) {
        entry.inUse = Math.max(0, entry.inUse - 1);
        entry.lastUsedAt = Date.now();
      }
      if (connection) await connection.close().catch(() => undefined);
    }
  }

  async function cleanupIdleUserPools() {
    const now = Date.now();
    const candidates = [...userPools.entries()].filter(([, entry]) => (
      !entry.closing
      && entry.inUse === 0
      && now - entry.lastUsedAt >= config.db.userPoolIdleTimeoutMs
    ));
    await Promise.all(candidates.map(([key, entry]) => closeUserPool(key, entry)));
  }

  if (config.db.poolEnabled && config.db.userPoolIdleTimeoutMs > 0) {
    cleanupTimer = setInterval(() => void cleanupIdleUserPools(), Math.min(config.db.userPoolIdleTimeoutMs, 60000));
    cleanupTimer.unref?.();
  }

  return {
    query(statement, params = []) {
      return withConnection(
        (connection) => connection.query(statement, params, { timeout: config.db.queryTimeoutSeconds }),
        config.db,
        false,
      );
    },
    queryAs(credentials, statement, params = []) {
      return withConnection(
        (connection) => connection.query(statement, params, { timeout: config.db.queryTimeoutSeconds }),
        credentials,
        true,
      );
    },
    checkHealth() {
      return withConnection((connection) => connection.query('SELECT 1 AS Healthy'), config.db, false);
    },
    async close() {
      if (cleanupTimer) clearInterval(cleanupTimer);
      await Promise.all([...userPools.entries()].map(([key, entry]) => closeUserPool(key, entry)));
      if (fixedPool && typeof fixedPool.close === 'function') await fixedPool.close();
      fixedPool = undefined;
      fixedPoolPromise = undefined;
    },
  };
}

module.exports = { createDatabase, formatConnectionValue };