const { createHttpError } = require('../../utils/httpError');

// AI_SUMMARY_DOCUMENT_LINK_PATCH_V1
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/i;
const UNSAFE_FILENAME_PATTERN = /[<>:"/\\|?*\x00-\x1F]/;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function positiveInteger(value, name, { min = 1, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw createHttpError(400, `${name} is required.`, 'VALIDATION_ERROR');
  }
  if (!/^\d+$/.test(String(value))) {
    throw createHttpError(400, `${name} must be a valid integer.`, 'VALIDATION_ERROR');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw createHttpError(400, `${name} must be a valid integer.`, 'VALIDATION_ERROR');
  }
  return parsed;
}

function parseSummaryId(value) {
  const summaryId = String(value || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(summaryId)) {
    throw createHttpError(400, 'summaryId must be a UUID.', 'VALIDATION_ERROR');
  }
  return summaryId;
}

function parseFileName(value) {
  const fileName = String(value || '').trim();
  if (
    !fileName
    || fileName.length > 255
    || UNSAFE_FILENAME_PATTERN.test(fileName)
    || fileName.endsWith('.')
    || fileName.endsWith(' ')
    || WINDOWS_RESERVED_NAME.test(fileName)
  ) {
    throw createHttpError(400, 'X-PVS-File-Name is invalid.', 'VALIDATION_ERROR');
  }
  return fileName;
}

function parseContentLength(req, maxBytes) {
  const raw = String(req.get('Content-Length') || '').trim();
  if (!/^\d+$/.test(raw)) {
    throw createHttpError(411, 'Content-Length is required.', 'GENERATED_REPORT_LENGTH_REQUIRED');
  }
  const contentLength = Number(raw);
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    throw createHttpError(400, 'Content-Length is invalid.', 'VALIDATION_ERROR');
  }
  if (contentLength > maxBytes) {
    throw createHttpError(413, 'Generated report exceeds the configured size limit.', 'GENERATED_REPORT_TOO_LARGE');
  }
  return contentLength;
}

function commonValues(req) {
  return {
    summaryId: parseSummaryId(req.params.summaryId),
    clientId: positiveInteger(req.query.clientId, 'clientId'),
    currentYear: positiveInteger(req.query.currentYear, 'currentYear', { min: 1900, max: 9999 }),
    documentId: positiveInteger(req.query.documentId, 'documentId', { optional: true }),
  };
}

function validateGeneratedReportUpload(config) {
  return function validateUpload(req, res, next) {
    try {
      const mediaType = String(req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
      if (mediaType !== 'application/pdf') {
        throw createHttpError(415, 'Content-Type must be application/pdf.', 'GENERATED_REPORT_CONTENT_TYPE_INVALID');
      }

      const expectedHash = String(req.get('X-PVS-Content-SHA256') || '').trim().toLowerCase();
      if (!HASH_PATTERN.test(expectedHash)) {
        throw createHttpError(400, 'X-PVS-Content-SHA256 is invalid.', 'VALIDATION_ERROR');
      }

      req.validated = {
        ...commonValues(req),
        fileName: parseFileName(req.get('X-PVS-File-Name')),
        contentLength: parseContentLength(req, config.generatedReports.maxBytes),
        expectedHash,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

function validateGeneratedReportRetrieval(req, res, next) {
  try {
    req.validated = commonValues(req);
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  HASH_PATTERN,
  UUID_PATTERN,
  parseFileName,
  parseSummaryId,
  validateGeneratedReportRetrieval,
  validateGeneratedReportUpload,
};
