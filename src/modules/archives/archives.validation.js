const { createHttpError } = require('../../utils/httpError');
const { safeDisplayName } = require('../../utils/filenames');
const { FILTER_NAMES, SORT_SQL } = require('./archives.constants');

function positiveInteger(value, name, { required = true, min = 1 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) return undefined;
    throw createHttpError(400, `${name} is required.`, 'VALIDATION_ERROR');
  }

  if (!/^\d+$/.test(String(value))) {
    throw createHttpError(400, `${name} must be a valid integer.`, 'VALIDATION_ERROR');
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    throw createHttpError(400, `${name} must be a valid integer.`, 'VALIDATION_ERROR');
  }
  return parsed;
}

function optionalText(value, name, maxLength) {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).trim();
  if (!text || text.length > maxLength || text.includes('\0')) {
    throw createHttpError(400, `${name} is invalid.`, 'VALIDATION_ERROR');
  }
  return text;
}

function escapeLike(value) {
  return value.replace(/[%_[]/g, (match) => `[${match}]`);
}

function wildcardText(value, name, maxLength) {
  const text = optionalText(value, name, maxLength);
  if (text === undefined || text === '%' || text.toLowerCase() === 'all') return undefined;
  return escapeLike(text);
}

function parseState(value) {
  const text = optionalText(value, 'filters.state', 20);
  if (text === undefined || text === '%' || text.toLowerCase() === 'all') return undefined;
  if (!/^[A-Za-z]{2}$/.test(text)) {
    throw createHttpError(400, 'filters.state must be a two-letter state code.', 'VALIDATION_ERROR');
  }
  return text.toUpperCase();
}

function parseFilters(value) {
  if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    throw createHttpError(400, 'filters must be an object.', 'VALIDATION_ERROR');
  }

  const source = value || {};
  const unknown = Object.keys(source).filter((name) => !FILTER_NAMES.includes(name));
  if (unknown.length > 0) {
    throw createHttpError(400, `Unsupported filter: ${unknown[0]}.`, 'VALIDATION_ERROR');
  }

  return {
    search: wildcardText(source.search, 'filters.search', 200),
    property: wildcardText(source.property, 'filters.property', 150),
    parcel: wildcardText(source.parcel, 'filters.parcel', 150),
    account: wildcardText(source.account, 'filters.account', 80),
    state: parseState(source.state),
    sysYear: positiveInteger(source.sysYear, 'filters.sysYear', { required: false, min: 1900 }),
    documentType: wildcardText(source.documentType, 'filters.documentType', 120),
    ownerName: wildcardText(source.ownerName, 'filters.ownerName', 150),
    assessor: wildcardText(source.assessor, 'filters.assessor', 150),
    locationCode: wildcardText(source.locationCode, 'filters.locationCode', 80),
    propMasterId: wildcardText(source.propMasterId, 'filters.propMasterId', 80),
    collectorId: positiveInteger(source.collectorId, 'filters.collectorId', { required: false }),
  };
}

function parseArchiveName(value, fallback) {
  const text = optionalText(value, 'archiveName', 80);
  return safeDisplayName(text || fallback, fallback).replace(/\.zip$/i, '');
}

function validateSelectedArchive(req, res, next) {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.documentIds) || body.documentIds.length === 0) {
      throw createHttpError(400, 'documentIds must be a non-empty array.', 'VALIDATION_ERROR');
    }
    const documentIds = [...new Set(body.documentIds.map((value) => positiveInteger(value, 'documentId')))];
    req.validated = {
      clientId: positiveInteger(body.clientId, 'clientId'),
      documentIds,
      archiveName: parseArchiveName(body.archiveName, 'documents'),
    };
    next();
  } catch (error) {
    next(error);
  }
}

function validateQueryArchive(req, res, next) {
  try {
    const body = req.body || {};
    const sort = body.sort === undefined || body.sort === null || body.sort === ''
      ? 'documentId'
      : String(body.sort).trim();
    if (!SORT_SQL[sort]) {
      throw createHttpError(400, 'sort is invalid.', 'VALIDATION_ERROR');
    }

    const offset = positiveInteger(body.offset, 'offset', { required: false, min: 0 });
    const limit = positiveInteger(body.limit, 'limit', { required: false });
    if ((offset === undefined) !== (limit === undefined)) {
      throw createHttpError(400, 'offset and limit must be supplied together.', 'VALIDATION_ERROR');
    }

    req.validated = {
      clientId: positiveInteger(body.clientId, 'clientId'),
      filters: parseFilters(body.filters),
      sort,
      sortSql: SORT_SQL[sort],
      offset,
      limit,
      mode: limit === undefined ? 'all' : 'batch',
      archiveName: parseArchiveName(body.archiveName, limit === undefined ? 'documents-all' : 'documents-batch'),
    };
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  FILTER_NAMES,
  SORTS: SORT_SQL,
  escapeLike,
  parseFilters,
  validateQueryArchive,
  validateSelectedArchive,
};
