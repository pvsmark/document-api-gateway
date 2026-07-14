const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Transform } = require('stream');
const { pipeline: pipelineDefault } = require('stream/promises');
const { createHttpError } = require('../../utils/httpError');
const { timingSafeEqualText } = require('../../utils/crypto');

function assertContained(root, target, pathImpl = path.win32) {
  const relative = pathImpl.relative(pathImpl.resolve(root), pathImpl.resolve(target));
  if (
    relative === '..'
    || relative.startsWith(`..${pathImpl.sep}`)
    || pathImpl.isAbsolute(relative)
  ) {
    throw createHttpError(403, 'Generated report path is outside the approved storage root.', 'GENERATED_REPORT_PATH_FORBIDDEN');
  }
}

function buildReportLocation(root, clientId, currentYear, summaryId, pathImpl = path.win32) {
  const relativeFilePath = path.win32.join(String(clientId), String(currentYear), `${summaryId}.pdf`);
  const directory = pathImpl.resolve(root, String(clientId), String(currentYear));
  const finalPath = pathImpl.resolve(directory, `${summaryId}.pdf`);
  assertContained(root, directory, pathImpl);
  assertContained(root, finalPath, pathImpl);
  return { directory, finalPath, relativeFilePath };
}

function createUploadVerifier({ declaredLength, maxBytes, signal }) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  let firstBytes = Buffer.alloc(0);

  const transform = new Transform({
    transform(chunk, encoding, callback) {
      if (signal?.aborted) {
        callback(createHttpError(499, 'Generated report upload was cancelled.', 'REQUEST_CANCELLED'));
        return;
      }
      bytes += chunk.length;
      if (bytes > maxBytes || bytes > declaredLength) {
        callback(createHttpError(413, 'Generated report exceeds the declared or configured size.', 'GENERATED_REPORT_TOO_LARGE'));
        return;
      }
      if (firstBytes.length < 5) {
        firstBytes = Buffer.concat([firstBytes, chunk.subarray(0, 5 - firstBytes.length)]);
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  return {
    transform,
    result() {
      return {
        bytes,
        firstBytes,
        fileHash: hash.digest('hex'),
      };
    },
  };
}

function createGeneratedReportsStorage(config, dependencies = {}) {
  const fileSystem = dependencies.fs || fs;
  const filePromises = dependencies.fsp || fsp;
  const pathImpl = dependencies.path || path.win32;
  const pipeline = dependencies.pipeline || pipelineDefault;
  const randomUUID = dependencies.randomUUID || crypto.randomUUID;
  const activeUploads = new Set();

  function location(values) {
    return buildReportLocation(
      config.storage.generatedReportRoot,
      values.clientId,
      values.currentYear,
      values.summaryId,
      pathImpl,
    );
  }

  async function hashFile(filePath) {
    const hash = crypto.createHash('sha256');
    const source = fileSystem.createReadStream(filePath);
    for await (const chunk of source) hash.update(chunk);
    return hash.digest('hex');
  }

  async function existingDescriptor(values, reportLocation, expectedHash, expectedSize) {
    let stat;
    try {
      stat = await filePromises.lstat(reportLocation.finalPath);
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw createHttpError(409, 'Generated report already exists.', 'GENERATED_REPORT_ALREADY_EXISTS');
    }
    const existingHash = await hashFile(reportLocation.finalPath);
    if (stat.size === expectedSize && timingSafeEqualText(existingHash, expectedHash)) {
      return {
        summaryId: values.summaryId,
        clientId: values.clientId,
        currentYear: values.currentYear,
        relativeFilePath: reportLocation.relativeFilePath,
        fileSize: stat.size,
        fileHash: existingHash,
        idempotent: true,
      };
    }
    throw createHttpError(409, 'Generated report already exists with different content.', 'GENERATED_REPORT_ALREADY_EXISTS');
  }

  async function persist(values, input, options = {}) {
    const reportLocation = location(values);
    const uploadKey = reportLocation.finalPath.toLowerCase();
    if (activeUploads.has(uploadKey)) {
      throw createHttpError(409, 'Generated report upload is already in progress.', 'GENERATED_REPORT_UPLOAD_IN_PROGRESS');
    }

    activeUploads.add(uploadKey);
    let stagingPath;
    try {
      await filePromises.mkdir(reportLocation.directory, { recursive: true });
      stagingPath = pathImpl.join(
        reportLocation.directory,
        `.pvs-report-${values.summaryId}-${randomUUID()}.staging`,
      );

      const verifier = createUploadVerifier({
        declaredLength: values.contentLength,
        maxBytes: config.generatedReports.maxBytes,
        signal: options.signal,
      });
      const output = fileSystem.createWriteStream(stagingPath, { flags: 'wx' });

      try {
        await pipeline(input, verifier.transform, output, { signal: options.signal });
      } catch (error) {
        if (options.signal?.aborted) {
          throw createHttpError(499, 'Generated report upload was cancelled.', 'REQUEST_CANCELLED');
        }
        throw error;
      }

      const result = verifier.result();
      if (result.bytes !== values.contentLength) {
        throw createHttpError(400, 'Generated report length did not match Content-Length.', 'GENERATED_REPORT_LENGTH_MISMATCH');
      }
      if (result.firstBytes.length < 5 || result.firstBytes.toString('ascii') !== '%PDF-') {
        throw createHttpError(400, 'Generated report is not a valid PDF.', 'GENERATED_REPORT_INVALID_PDF');
      }
      if (!timingSafeEqualText(result.fileHash, values.expectedHash)) {
        throw createHttpError(400, 'Generated report hash did not match the signed hash.', 'GENERATED_REPORT_HASH_MISMATCH');
      }

      const existing = await existingDescriptor(
        values,
        reportLocation,
        result.fileHash,
        result.bytes,
      );
      if (existing) return existing;

      try {
        await filePromises.rename(stagingPath, reportLocation.finalPath);
        stagingPath = undefined;
      } catch (error) {
        if (['EEXIST', 'EPERM', 'EACCES'].includes(error && error.code)) {
          const racedExisting = await existingDescriptor(
            values,
            reportLocation,
            result.fileHash,
            result.bytes,
          );
          if (racedExisting) return racedExisting;
        }
        throw error;
      }

      return {
        summaryId: values.summaryId,
        clientId: values.clientId,
        currentYear: values.currentYear,
        relativeFilePath: reportLocation.relativeFilePath,
        fileSize: result.bytes,
        fileHash: result.fileHash,
        idempotent: false,
      };
    } finally {
      if (stagingPath) await filePromises.rm(stagingPath, { force: true }).catch(() => undefined);
      activeUploads.delete(uploadKey);
    }
  }

  async function prepare(values) {
    const reportLocation = location(values);
    let stat;
    try {
      stat = await filePromises.lstat(reportLocation.finalPath);
    } catch (error) {
      if (['ENOENT', 'EACCES', 'EPERM'].includes(error && error.code)) {
        throw createHttpError(404, 'Generated report was not found.', 'GENERATED_REPORT_NOT_FOUND');
      }
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw createHttpError(404, 'Generated report was not found.', 'GENERATED_REPORT_NOT_FOUND');
    }
    return {
      size: stat.size,
      filePath: reportLocation.finalPath,
      createReadStream: () => fileSystem.createReadStream(reportLocation.finalPath),
    };
  }

  return {
    buildLocation: location,
    persist,
    prepare,
  };
}

module.exports = {
  assertContained,
  buildReportLocation,
  createGeneratedReportsStorage,
  createUploadVerifier,
};