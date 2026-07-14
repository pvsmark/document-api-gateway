const fs = require('fs');
const path = require('path');
const { createHttpError } = require('./httpError');
const { safeDisplayName } = require('./filenames');

function uniqueArchiveName(fileName, usedNames) {
  const safe = safeDisplayName(fileName, 'document');
  const parsed = path.parse(safe);
  let candidate = `files/${safe}`;
  let index = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const renamed = parsed.ext ? `${parsed.name} (${index})${parsed.ext}` : `${safe} (${index})`;
    candidate = `files/${renamed}`;
    index += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function createZipWriter({ output, archiveFactory, idleTimeoutMs, signal, onProgress }) {
  const factory = archiveFactory || require('archiver');
  const archive = factory('zip', {
    forceZip64: true,
    store: true,
    zlib: { level: 0 },
  });

  let idleTimer;
  let settled = false;
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      archive.abort();
      output.destroy(createHttpError(504, 'Archive generation stalled.', 'ZIP_IDLE_TIMEOUT'));
    }, idleTimeoutMs);
    idleTimer.unref?.();
    if (onProgress) onProgress();
  };

  const abort = () => {
    archive.abort();
    output.destroy(createHttpError(499, 'Archive request was cancelled.', 'REQUEST_CANCELLED'));
  };
  signal?.addEventListener('abort', abort, { once: true });

  const completed = new Promise((resolve, reject) => {
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    output.once('close', () => finish());
    output.once('error', finish);
    archive.once('error', finish);
    archive.on('warning', (error) => {
      if (error.code !== 'ENOENT') finish(error);
    });
  });

  archive.on('progress', touch);
  archive.pipe(output);
  touch();

  return {
    archive,
    completed,
    appendFile(filePath, archiveName) {
      touch();
      archive.append(fs.createReadStream(filePath), { name: archiveName, store: true });
    },
    appendJson(value, archiveName) {
      touch();
      archive.append(Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'), {
        name: archiveName,
        store: true,
      });
    },
    async finalize() {
      await archive.finalize();
      await completed;
    },
  };
}

module.exports = { createZipWriter, uniqueArchiveName };
