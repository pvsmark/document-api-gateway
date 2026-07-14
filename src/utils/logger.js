const PRIORITY = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function safeError(error) {
  if (!error) return undefined;
  return { name: error.name, code: error.code };
}

function createLogger(level = 'info', sink = console) {
  const minimum = PRIORITY[level] || PRIORITY.info;
  function write(selectedLevel, event, fields = {}) {
    if ((PRIORITY[selectedLevel] || PRIORITY.info) < minimum) return;
    const payload = JSON.stringify({
      timestamp: new Date().toISOString(),
      level: selectedLevel,
      event,
      ...fields,
    });
    if (selectedLevel === 'error') sink.error(payload);
    else if (selectedLevel === 'warn') sink.warn(payload);
    else sink.log(payload);
  }
  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}

module.exports = { createLogger, safeError };
