function createDocumentsRepository(database) {
  return {
    async findDocumentById(clientId, documentId) {
      const rows = await database.query(
        `
          SELECT TOP 1
            DocumentID,
            FileName,
            Name,
            Ext
          FROM tso.Web2_WebDocumentListView
          WHERE ClientMasterID = ?
            AND DocumentID = ?
        `,
        [clientId, documentId],
      );
      return Array.isArray(rows) ? rows[0] || null : null;
    },

    async findDocumentSourcePath(documentId) {
      const rows = await database.query(
        'CALL "tso"."Web2_GetDocumentSourcePath"(?)',
        [documentId],
      );
      return Array.isArray(rows) ? rows[0] || null : null;
    },
  };
}

module.exports = { createDocumentsRepository };
