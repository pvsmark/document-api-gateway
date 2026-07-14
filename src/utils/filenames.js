const path = require('path');

const CONTENT_TYPES = Object.freeze({
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  gif: 'image/gif',
  htm: 'text/html',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  pdf: 'application/pdf',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  txt: 'text/plain',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
});

function safeDisplayName(value, fallback = 'document') {
  const selected = String(value || fallback).trim();
  const cleaned = selected
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function extensionFrom(documentRecord) {
  const value = String(
    documentRecord.Ext || path.extname(documentRecord.FileName || documentRecord.Name || ''),
  ).trim();
  return value.replace(/^\./, '').toLowerCase();
}

function downloadFileName(documentRecord) {
  const extension = extensionFrom(documentRecord);
  const fallback = extension
    ? `document-${documentRecord.DocumentID}.${extension}`
    : `document-${documentRecord.DocumentID}`;
  const selected = safeDisplayName(documentRecord.FileName || documentRecord.Name, fallback);
  return path.extname(selected) || !extension ? selected : `${selected}.${extension}`;
}

function contentTypeFor(documentRecord) {
  return CONTENT_TYPES[extensionFrom(documentRecord)] || 'application/octet-stream';
}

module.exports = {
  contentTypeFor,
  downloadFileName,
  extensionFrom,
  safeDisplayName,
};
