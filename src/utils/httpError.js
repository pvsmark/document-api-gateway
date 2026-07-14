class HttpError extends Error {
  constructor(status, message, code, options = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.expose = options.expose !== false;
  }
}

function createHttpError(status, message, code, options) {
  return new HttpError(status, message, code, options);
}

module.exports = { HttpError, createHttpError };
