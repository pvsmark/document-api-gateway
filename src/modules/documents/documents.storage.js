const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { createHttpError } = require('../../utils/httpError');

function field(record, names) {
  if (!record || typeof record !== 'object') return undefined;
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null) return record[name];
  }
  const lowered = new Map(Object.keys(record).map((key) => [key.toLowerCase(), key]));
  for (const name of names) {
    const actual = lowered.get(name.toLowerCase());
    if (actual) return record[actual];
  }
  return undefined;
}

function sourceRelativePath(sourceRecord, root) {
  const declared = String(field(sourceRecord, ['SourceRelativePath']) || '')
    .trim()
    .replace(/\//g, '\\');
  if (declared) return declared;

  const stored = String(field(sourceRecord, [
    'SourceStoredPath',
    'DocumentName',
    'documentname',
    'documentName',
  ]) || '').trim().replace(/\//g, '\\');

  if (!stored || stored.includes('\0')) return null;

  const extendedDrive = stored.match(/^\\\\\?\\[A-Za-z]:\\(.+)$/);
  if (extendedDrive) return extendedDrive[1];

  const drive = stored.match(/^[A-Za-z]:\\(.+)$/);
  if (drive) return drive[1];

  const normalizedStored = path.win32.normalize(stored);
  const normalizedRoot = path.win32.normalize(root);
  const prefix = normalizedRoot.endsWith('\\') ? normalizedRoot : `${normalizedRoot}\\`;
  if (normalizedStored.toLowerCase().startsWith(prefix.toLowerCase())) {
    return normalizedStored.slice(prefix.length);
  }

  return null;
}

function resolveSourcePath(sourceRecord, configuredRoot) {
  const root = path.win32.normalize(configuredRoot);
  const relative = sourceRelativePath(sourceRecord, root);

  if (!relative || relative.includes('\0') || path.win32.isAbsolute(relative)) {
    throw createHttpError(
      422,
      'The document source path is not supported.',
      'DOCUMENT_SOURCE_PATH_UNSUPPORTED',
    );
  }

  const resolved = path.win32.resolve(root, relative);
  const containment = path.win32.relative(root, resolved);
  if (
    containment === '..'
    || containment.startsWith(`..${path.win32.sep}`)
    || path.win32.isAbsolute(containment)
  ) {
    throw createHttpError(
      403,
      'The document source path is outside the approved storage root.',
      'DOCUMENT_SOURCE_PATH_FORBIDDEN',
    );
  }
  return resolved;
}

function createDocumentsStorage(config, dependencies = {}) {
  const fileSystem = dependencies.fs || fs;
  const filePromises = dependencies.fsp || fsp;

  return {
    resolveSourcePath(sourceRecord) {
      return resolveSourcePath(sourceRecord, config.storage.documentSourceRoot);
    },

    async prepareSource(sourceRecord) {
      const filePath = resolveSourcePath(sourceRecord, config.storage.documentSourceRoot);
      let stat;
      try {
        stat = await filePromises.stat(filePath);
      } catch (error) {
        if (['ENOENT', 'EACCES', 'EPERM'].includes(error && error.code)) {
          throw createHttpError(404, 'Document file is not available.', 'DOCUMENT_FILE_NOT_FOUND');
        }
        throw error;
      }

      if (!stat.isFile()) {
        throw createHttpError(404, 'Document file is not available.', 'DOCUMENT_FILE_NOT_FOUND');
      }

      return {
        filePath,
        modifiedAt: stat.mtime,
        size: stat.size,
        createReadStream: () => fileSystem.createReadStream(filePath),
      };
    },
  };
}

module.exports = {
  createDocumentsStorage,
  resolveSourcePath,
  sourceRelativePath,
};
