const fs = require('fs');
const { pipeline } = require('stream/promises');

function createArchivesController({ service, logger }) {
  async function sendArchive(req, res, descriptor) {
    res.status(200);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(descriptor.size));
    res.setHeader('X-PVS-Successful-Documents', String(descriptor.successfulDocuments));
    res.setHeader('X-PVS-Failed-Documents', String(descriptor.failedDocuments));

    let completed = false;
    try {
      await pipeline(fs.createReadStream(descriptor.filePath), res);
      completed = true;
    } finally {
      await service.cleanup(descriptor);
      logger.info('archive_stream_completed', {
        requestId: req.requestId,
        operation: 'archive.stream',
        status: completed ? 200 : 499,
        bytes: descriptor.size,
      });
    }
  }

  function requestContext(req, res) {
    const controller = new AbortController();
    const abort = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once('aborted', abort);
    res.once('close', abort);
    return {
      requestId: req.requestId,
      signal: controller.signal,
      cleanup() {
        req.removeListener('aborted', abort);
        res.removeListener('close', abort);
      },
    };
  }

  return {
    async selected(req, res) {
      const context = requestContext(req, res);
      try {
        const descriptor = await service.createSelectedArchive(req.validated, context);
        context.cleanup();
        await sendArchive(req, res, descriptor);
      } catch (error) {
        context.cleanup();
        throw error;
      }
    },

    async query(req, res) {
      const context = requestContext(req, res);
      try {
        const descriptor = await service.createQueryArchive(req.validated, context);
        context.cleanup();
        await sendArchive(req, res, descriptor);
      } catch (error) {
        context.cleanup();
        throw error;
      }
    },
  };
}

module.exports = { createArchivesController };
