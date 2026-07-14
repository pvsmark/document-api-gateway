const { createHttpError } = require('../../utils/httpError');
const { safeDisplayName } = require('../../utils/filenames');

const SORTS = Object.freeze({
  property: 'documents.Prop ASC, documents.DocumentID ASC',
  '-property': 'documents.Prop DESC, documents.DocumentID DESC',
  fileName: 'documents.FileName ASC, documents.DocumentID ASC',
  '-fileName': 'documents.FileName DESC, documents.DocumentID DESC',
  documentType: 'documents.DocumentType ASC, documents.Prop ASC, documents.DocumentID ASC',
  '-documentType': 'documents.DocumentType DESC, documents.Prop DESC, documents.DocumentID DESC',
  account: 'documents.Account ASC, documents.Prop ASC, documents.DocumentID ASC',
  '-account': 'documents.Account DESC, documents.Prop DESC, documents.DocumentID DESC',
  state: 'documents.State ASC, documents.Prop ASC, documents.DocumentID ASC',
  '-state': 'documents.State DESC, documents.Prop DESC, documents.DocumentID DESC',
  sysYear: 'documents.SysYear ASC, documents.Prop ASC, documents.DocumentID ASC',
  '-sysYear': 'documents.SysYear DESC, documents.Prop DESC, documents.DocumentID DESC',
  ownerName: 'documents.OwnerName ASC, documents.Prop ASC, documents.DocumentID ASC',
  '-ownerName': 'documents.OwnerName DESC, documents.Prop DESC, documents.DocumentID DESC',
  assessor: 'documents.Assessor ASC, documents.Prop ASC, documents.DocumentID ASC',
  '-assessor': 'documents.Assessor DESC, documents.Prop DESC, documents.DocumentID DESC',
  locationCode: 'documents.LocationCode ASC, documents.Prop ASC, documents.DocumentID ASC',
  '-locationCode': 'documents.LocationCode DESC, documents.Prop DESC, documents.DocumentID DESC',
  propMasterId: 'documents.PropMasterID ASC, documents.Prop ASC, documents.DocumentID ASC',
  '-propMasterId': 'documents.PropMasterID DESC, documents.Prop DESC, documents.DocumentID DESC',
  collectorId: 'documents.CollectorID ASC, documents.Prop ASC, documents.DocumentID ASC',
  '-collectorId': 'documents.CollectorID DESC, documents.Prop DESC, documents.DocumentID DESC',
  documentId: 'documents.DocumentID ASC',
  '-documentId': 'documents.DocumentID DESC',
});

function positiveInteger(value, name, { required = true, min = 1 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) return undefined;
    throw createHttpError(400, `${name} is required.`, 'VALIDATION_ERROR');
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

function likeText(value, name, maxLength) {
  const text = optionalText(value, name, maxLength);
  if (text === undefined || text === '%' || text.toLowerCase() === 'all') return undefined;
  return text;
}

function parseFilters(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    search: likeText(source.search, 'filters.search', 200),
    property: likeText(source.property, 'filters.property', 150),
    parcel: likeText(source.parcel, 'filters.parcel', 150),
    account: likeText(source.account, 'filters.account', 80),
    state: likeText(source.state, 'filters.state', 20),
    sysYear: positiveInteger(source.sysYear, 'filters.sysYear', { required: false, min: 1900 }),
    documentType: likeText(source.documentType, 'filters.documentType', 120),
    ownerName: likeText(source.ownerName, 'filters.ownerName', 150),
    assessor: likeText(source.assessor, 'filters.assessor', 150),
    locationCode: likeText(source.locationCode, 'filters.locationCode', 80),
    propMasterId: likeText(source.propMasterId, 'filters.propMasterId', 80),
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
    if (!SORTS[sort]) {
      throw createHttpError(400, 'sort is invalid.', 'VALIDATION_ERROR');
    }
    req.validated = {
      clientId: positiveInteger(body.clientId, 'clientId'),
      filters: parseFilters(body.filters),
      sort,
      sortSql: SORTS[sort],
      offset: positiveInteger(body.offset, 'offset', { required: false, min: 0 }),
      limit: positiveInteger(body.limit, 'limit', { required: false }),
      archiveName: parseArchiveName(body.archiveName, 'documents-all'),
    };
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  SORTS,
  parseFilters,
  validateQueryArchive,
  validateSelectedArchive,
};
