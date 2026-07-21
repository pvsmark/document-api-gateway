const { createHttpError } = require('../../utils/httpError');

// AI_SUMMARY_DOCUMENT_LINK_PATCH_V1
function rowValue(row, expectedName) {
  if (!row || typeof row !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(row, expectedName)) return row[expectedName];
  const expected = expectedName.toLowerCase();
  const key = Object.keys(row).find((name) => name.toLowerCase() === expected);
  return key ? row[key] : undefined;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function textValue(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function createGeneratedReportsRepository(database) {
  if (!database || typeof database.query !== 'function') {
    throw new Error('Generated reports repository requires the fixed service database.');
  }

  return {
    async findTarget(values) {
      const rows = await database.query(
        `CALL "tso"."WebAI_GetGeneratedReportTarget"(?, ?, ?, ?)`,
        [values.summaryId, values.clientId, values.currentYear, values.documentId],
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return null;

      const target = {
        summaryId: textValue(rowValue(row, 'AISummaryID')),
        documentId: positiveInteger(rowValue(row, 'DocumentID')),
        clientId: positiveInteger(rowValue(row, 'ClientMasterID')),
        currentYear: positiveInteger(rowValue(row, 'CurrentYear')),
        summaryStatus: textValue(rowValue(row, 'SummaryStatus')),
        fileName: textValue(rowValue(row, 'FileName')),
        sourcePathType: textValue(rowValue(row, 'SourcePathType')),
        sourceDrive: textValue(rowValue(row, 'SourceDrive')),
        sourceStoredPath: textValue(rowValue(row, 'SourceStoredPath')),
        sourceRelativePath: textValue(rowValue(row, 'SourceRelativePath')),
      };

      if (
        !target.summaryId
        || !target.documentId
        || !target.clientId
        || !target.currentYear
        || !target.fileName
        || !target.sourceStoredPath
      ) {
        throw createHttpError(
          502,
          'The database returned an invalid generated-report target.',
          'GENERATED_REPORT_TARGET_INVALID',
        );
      }
      return target;
    },
  };
}

module.exports = { createGeneratedReportsRepository };
