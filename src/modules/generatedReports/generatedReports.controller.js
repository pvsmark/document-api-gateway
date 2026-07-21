const { pipeline } = require('stream/promises');

// AI_SUMMARY_DOCUMENT_LINK_PATCH_V1
function createGeneratedReportsController({ service, logger }) {
  function requestContext(req, res) {
    const controller = new AbortController();
    const abort = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once('aborted', abort);
    res.once('close', abort);
    return {
      signal: controller.signal,
      cleanup() {
        req.removeListener('aborted', abort);
        res.removeListener('close', abort);
      },
    };
  }

  return {
    async upload(req, res) {
      const startedAt = Date.now();
      const context = requestContext(req, res);
      try {
        const descriptor = await service.upload(req.validated, req, { signal: context.signal });
        context.cleanup();
        logger.info('generated_report_uploaded', {
          requestId: req.requestId,
          operation: 'generated-report.upload',
          callerKeyId: req.callerKeyId,
          clientId: descriptor.clientId,
          documentId: descriptor.documentId || undefined,
          summaryId: descriptor.summaryId,
          bytes: descriptor.fileSize,
          idempotent: descriptor.idempotent,
          durationMs: Date.now() - startedAt,
          status: descriptor.idempotent ? 200 : 201,
        });
        return res.status(descriptor.idempotent ? 200 : 201).json({
          summaryId: descriptor.summaryId,
          documentId: descriptor.documentId || null,
          clientId: descriptor.clientId,
          currentYear: descriptor.currentYear,
          fileName: descriptor.fileName,
          relativeFilePath: descriptor.relativeFilePath,
          fileSize: descriptor.fileSize,
          fileHash: descriptor.fileHash,
          idempotent: descriptor.idempotent,
        });
      } catch (error) {
        context.cleanup();
        throw error;
      }
    },

    async retrieve(req, res) {
      const startedAt = Date.now();
      const descriptor = await service.get(req.validated);
      const source = descriptor.createReadStream();
      const stopSource = () => {
        if (!source.destroyed) source.destroy();
      };
      req.once('aborted', stopSource);
      res.once('close', () => {
        if (!res.writableEnded) stopSource();
      });

      res.status(200);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(descriptor.size));
      res.setHeader('X-PVS-Summary-Id', descriptor.summaryId);
      if (descriptor.documentId) res.setHeader('X-PVS-Document-Id', String(descriptor.documentId));

      try {
        await pipeline(source, res);
        logger.info('generated_report_stream_completed', {
          requestId: req.requestId,
          operation: 'generated-report.stream',
          callerKeyId: req.callerKeyId,
          clientId: descriptor.clientId,
          documentId: descriptor.documentId || undefined,
          summaryId: descriptor.summaryId,
          bytes: descriptor.size,
          durationMs: Date.now() - startedAt,
          status: 200,
        });
      } catch (error) {
        if (req.aborted || res.destroyed) {
          logger.warn('generated_report_stream_cancelled', {
            requestId: req.requestId,
            operation: 'generated-report.stream',
            callerKeyId: req.callerKeyId,
            clientId: descriptor.clientId,
            documentId: descriptor.documentId || undefined,
            summaryId: descriptor.summaryId,
            durationMs: Date.now() - startedAt,
          });
          return;
        }
        throw error;
      }
    },
  };
}

module.exports = { createGeneratedReportsController };
