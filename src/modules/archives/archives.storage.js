const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { createDocumentsStorage } = require('../documents/documents.storage');
const { assertDiskReserve } = require('../../utils/diskSpace');

function createArchivesStorage(config, dependencies = {}) {
  const filePromises = dependencies.fsp || fsp;
  const fileSystem = dependencies.fs || fs;
  const documentStorage = dependencies.documentStorage || createDocumentsStorage(config, dependencies);
  const diskCheck = dependencies.assertDiskReserve || assertDiskReserve;

  return {
    async createWorkDirectory(requestId) {
      await filePromises.mkdir(config.storage.tempRoot, { recursive: true });
      const safeRequestId = String(requestId || 'request').replace(/[^A-Za-z0-9._-]/g, '_');
      return filePromises.mkdtemp(path.join(config.storage.tempRoot, `pvs-archive-${safeRequestId}-${crypto.randomUUID()}-`));
    },

    async cleanup(targetPath) {
      if (!targetPath) return;
      await filePromises.rm(targetPath, { recursive: true, force: true }).catch(() => undefined);
    },

    async ensureDiskReserve() {
      return diskCheck(config.storage.tempRoot, config.zip.minFreeDiskBytes, dependencies);
    },

    createWriteStream(filePath) {
      return fileSystem.createWriteStream(filePath, { flags: 'wx' });
    },

    stat(filePath) {
      return filePromises.stat(filePath);
    },

    prepareSource(sourceRecord) {
      return documentStorage.prepareSource(sourceRecord);
    },
  };
}

module.exports = { createArchivesStorage };
