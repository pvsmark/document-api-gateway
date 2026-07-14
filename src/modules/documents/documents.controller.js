const { pipeline } = require('stream/promises');

function createDocumentsController({ service, logger }) {
  return {
    async streamDocument(req, res) {
      const startedAt = Date.now();
      const descriptor = await service.getDocument(req.validated);
      const source = descriptor.stream || descriptor.createReadStream();

      res.setHeader('Content-Type', descriptor.contentType || 'application/octet-stream');
      res.setHeader('Content-Length', String(descriptor.size));
      res.setHeader('X-PVS-Document-Id', String(descriptor.documentId));

      const stopSource = () => {
        if (!source.destroyed) source.destroy();
      };
      req.once('aborted', stopSource);
      res.once('close', () => {
        if (!res.writableEnded) stopSource();
      });

      try {
        await pipeline(source, res);
        logger.info('document_stream_completed', {
          requestId: req.requestId,
          operation: 'document.stream',
          callerKeyId: req.callerKeyId,
          clientId: req.validated.clientId,
          documentId: descriptor.documentId,
          bytes: descriptor.size,
          durationMs: Date.now() - startedAt,
          status: 200,
        });
      } catch (error) {
        if (req.aborted || res.destroyed) {
          logger.warn('document_stream_cancelled', {
            requestId: req.requestId,
            operation: 'document.stream',
            callerKeyId: req.callerKeyId,
            clientId: req.validated.clientId,
            documentId: descriptor.documentId,
            durationMs: Date.now() - startedAt,
          });
          return;
        }
        throw error;
      }
    },
  };
}

module.exports = { createDocumentsController };
