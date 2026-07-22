const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Transform } = require('stream');
const { pipeline: pipelineDefault } = require('stream/promises');
const { resolveSourcePath } = require('../documents/documents.storage');
const { createHttpError } = require('../../utils/httpError');
const { timingSafeEqualText } = require('../../utils/crypto');

// AI_SUMMARY_DOCUMENT_LINK_PATCH_V1
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
  return { directory, finalPath, relativeFilePath, fileName: `${summaryId}.pdf`, legacy: true };
}

function buildDocumentReportLocation(config, values, target, pathImpl = path.win32) {
  const finalPath = resolveSourcePath({
    SourceStoredPath: target.sourceStoredPath,
    SourceRelativePath: target.sourceRelativePath,
  }, config.storage.documentSourceRoot);
  assertContained(config.storage.documentSourceRoot, finalPath, pathImpl);
  const fileName = pathImpl.basename(finalPath);
  if (pathImpl.extname(fileName).toLowerCase() !== '.pdf') {
    throw createHttpError(422, 'The generated report target must be a PDF.', 'GENERATED_REPORT_TARGET_EXTENSION_INVALID');
  }
  if (fileName.toLowerCase() !== String(values.fileName || target.fileName).toLowerCase()) {
    throw createHttpError(409, 'The generated report filename does not match the database target.', 'GENERATED_REPORT_FILENAME_MISMATCH');
  }
  return {
    directory: pathImpl.dirname(finalPath),
    finalPath,
    relativeFilePath: pathImpl.relative(config.storage.documentSourceRoot, finalPath),
    fileName,
    legacy: false,
  };
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
      return { bytes, firstBytes, fileHash: hash.digest('hex') };
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

  function location(values, target) {
    if (target) return buildDocumentReportLocation(config, values, target, pathImpl);
    return buildReportLocation(
      config.storage.generatedReportRoot,
      values.clientId,
      values.currentYear,
      values.summaryId,
      pathImpl,
    );
  }

  // AI_SUMMARY_GATEWAY_NESTED_DIR_FIX_V1
  async function ensureDocumentDirectory(directory) {
    async function readDirectory(directoryPath, missingCode, invalidCode, missingMessage, invalidMessage) {
      let stat;
      try {
        stat = await filePromises.lstat(directoryPath);
      } catch (error) {
        if (error && error.code === 'ENOENT') {
          throw createHttpError(404, missingMessage, missingCode);
        }
        throw error;
      }

      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw createHttpError(409, invalidMessage, invalidCode);
      }

      return stat;
    }

    try {
      const stat = await filePromises.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw createHttpError(
          409,
          'Generated report directory is invalid.',
          'GENERATED_REPORT_DIRECTORY_INVALID',
        );
      }
      return;
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }

    const categoryDirectory = pathImpl.dirname(directory);
    const clientDirectory = pathImpl.dirname(categoryDirectory);

    // AI_SUMMARY_GENERATED_YEAR_LOCATION_V1
    // Never create the client folder. It must already exist in the approved
    // PVS document tree. Only the database-approved category and year folders may be created.
    await readDirectory(
      clientDirectory,
      'GENERATED_REPORT_CLIENT_DIRECTORY_NOT_FOUND',
      'GENERATED_REPORT_CLIENT_DIRECTORY_INVALID',
      'The client document directory does not exist.',
      'The client document directory is invalid.',
    );

    try {
      await filePromises.mkdir(categoryDirectory, { recursive: false });
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
    }

    await readDirectory(
      categoryDirectory,
      'GENERATED_REPORT_CATEGORY_DIRECTORY_NOT_FOUND',
      'GENERATED_REPORT_CATEGORY_DIRECTORY_INVALID',
      'The generated report category directory could not be created.',
      'The generated report category directory is invalid.',
    );

    try {
      await filePromises.mkdir(directory, { recursive: false });
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
    }

    await readDirectory(
      directory,
      'GENERATED_REPORT_DIRECTORY_NOT_FOUND',
      'GENERATED_REPORT_DIRECTORY_INVALID',
      'The generated report year directory could not be created.',
      'The generated report directory is invalid.',
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
        documentId: values.documentId || null,
        clientId: values.clientId,
        currentYear: values.currentYear,
        fileName: reportLocation.fileName,
        relativeFilePath: reportLocation.relativeFilePath,
        fileSize: stat.size,
        fileHash: existingHash,
        idempotent: true,
      };
    }
    throw createHttpError(409, 'Generated report already exists with different content.', 'GENERATED_REPORT_ALREADY_EXISTS');
  }

  async function persist(values, input, options = {}) {
    const reportLocation = location(values, options.target);
    const uploadKey = reportLocation.finalPath.toLowerCase();
    if (activeUploads.has(uploadKey)) {
      throw createHttpError(409, 'Generated report upload is already in progress.', 'GENERATED_REPORT_UPLOAD_IN_PROGRESS');
    }

    activeUploads.add(uploadKey);
    let stagingPath;
    try {
      if (reportLocation.legacy) {
        await filePromises.mkdir(reportLocation.directory, { recursive: true });
      } else {
        await ensureDocumentDirectory(reportLocation.directory);
      }
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
        values, reportLocation, result.fileHash, result.bytes,
      );
      if (existing) return existing;

      try {
        await filePromises.rename(stagingPath, reportLocation.finalPath);
        stagingPath = undefined;
      } catch (error) {
        if (['EEXIST', 'EPERM', 'EACCES'].includes(error && error.code)) {
          const racedExisting = await existingDescriptor(
            values, reportLocation, result.fileHash, result.bytes,
          );
          if (racedExisting) return racedExisting;
        }
        throw error;
      }

      return {
        summaryId: values.summaryId,
        documentId: values.documentId || null,
        clientId: values.clientId,
        currentYear: values.currentYear,
        fileName: reportLocation.fileName,
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

  async function prepare(values, options = {}) {
    const reportLocation = location(values, options.target);
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
      fileName: reportLocation.fileName,
      size: stat.size,
      filePath: reportLocation.finalPath,
      createReadStream: () => fileSystem.createReadStream(reportLocation.finalPath),
    };
  }

  return { buildLocation: location, persist, prepare };
}

module.exports = {
  assertContained,
  buildDocumentReportLocation,
  buildReportLocation,
  createGeneratedReportsStorage,
  createUploadVerifier,
};
