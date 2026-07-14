const odbc = require('odbc');
const { createHttpError } = require('../utils/httpError');

function formatConnectionValue(value) {
  const text = String(value);
  return /[;{}]/.test(text) ? '{' + text.replace(/}/g, '}}') + '}' : text;
}

function createDatabase(config, logger) {
  let poolPromise;
  let pool;

  function connectionConfig() {
    return {
      connectionString: [
        `DSN=${formatConnectionValue(config.db.dsn)}`,
        `UID=${formatConnectionValue(config.db.uid)}`,
        `PWD=${formatConnectionValue(config.db.pwd)}`,
      ].join(';'),
      loginTimeout: config.db.loginTimeoutSeconds,
      connectionTimeout: config.db.connectionTimeoutSeconds,
    };
  }

  async function getPool() {
    if (!config.db.poolEnabled || typeof odbc.pool !== 'function') return null;
    if (!poolPromise) {
      poolPromise = odbc.pool({
        ...connectionConfig(),
        initialSize: config.db.poolInitialSize,
        incrementSize: config.db.poolIncrementSize,
        maxSize: config.db.poolMaxSize,
        reuseConnections: true,
      }).then((created) => {
        pool = created;
        return created;
      });
    }
    return poolPromise;
  }

  async function withConnection(callback) {
    let connection;
    try {
      const selectedPool = await getPool();
      connection = selectedPool ? await selectedPool.connect() : await odbc.connect(connectionConfig());
      return await callback(connection);
    } catch (error) {
      logger.error('database_operation_failed', { code: error.code });
      throw createHttpError(503, 'Database is unavailable.', 'DATABASE_UNAVAILABLE');
    } finally {
      if (connection) await connection.close().catch(() => undefined);
    }
  }

  return {
    query(statement, params = []) {
      return withConnection((connection) => connection.query(statement, params, {
        timeout: config.db.queryTimeoutSeconds,
      }));
    },
    checkHealth() {
      return withConnection((connection) => connection.query('SELECT 1 AS Healthy'));
    },
    async close() {
      if (pool && typeof pool.close === 'function') await pool.close();
      pool = undefined;
      poolPromise = undefined;
    },
  };
}

module.exports = { createDatabase, formatConnectionValue };
