const { createHttpError } = require('../../utils/httpError');

function positiveSafeInteger(value, fieldName) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!/^\d+$/.test(text)) {
    throw createHttpError(400, `${fieldName} must be a positive integer.`, 'VALIDATION_ERROR');
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw createHttpError(400, `${fieldName} must be a positive integer.`, 'VALIDATION_ERROR');
  }
  return parsed;
}

function validateDocumentRequest(req, res, next) {
  try {
    req.validated = {
      ...(req.validated || {}),
      clientId: positiveSafeInteger(req.query.clientId, 'clientId'),
      documentId: positiveSafeInteger(req.params.documentId, 'documentId'),
    };
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { positiveSafeInteger, validateDocumentRequest };
