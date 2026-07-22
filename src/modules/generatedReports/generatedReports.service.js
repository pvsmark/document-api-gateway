const { createHttpError } = require('../../utils/httpError');

// AI_SUMMARY_DOCUMENT_LINK_PATCH_V1
function createGeneratedReportsService({ repository, storage }) {
  async function targetFor(values) {
    if (!values.documentId) return null;
    const target = await repository.findTarget(values);
    if (!target) {
      throw createHttpError(
        404,
        'The generated report target was not found.',
        'GENERATED_REPORT_TARGET_NOT_FOUND',
      );
    }
    if (
      target.summaryId.toLowerCase() !== values.summaryId.toLowerCase()
      || target.documentId !== values.documentId
      || target.clientId !== values.clientId
      || target.currentYear !== values.currentYear
      || (values.generatedYear && target.generatedYear !== values.generatedYear)
    ) {
      throw createHttpError(
        403,
        'The generated report target does not match the request.',
        'GENERATED_REPORT_TARGET_MISMATCH',
      );
    }
    return target;
  }

  return {
    async upload(values, input, options = {}) {
      const target = await targetFor(values);
      return storage.persist(values, input, { ...options, target });
    },

    async get(values) {
      const target = await targetFor(values);
      const prepared = await storage.prepare(values, { target });
      return {
        summaryId: values.summaryId,
        documentId: values.documentId,
        clientId: values.clientId,
        currentYear: values.currentYear,
        fileName: prepared.fileName,
        size: prepared.size,
        createReadStream: prepared.createReadStream,
      };
    },
  };
}

module.exports = { createGeneratedReportsService };
