function runQuery(database, dbCredentials, statement, params) {
  if (dbCredentials && typeof database.queryAs === 'function') {
    return database.queryAs(dbCredentials, statement, params);
  }
  return database.query(statement, params);
}

function createDocumentsRepository(database) {
  return {
    async findDocumentById(clientId, documentId, dbCredentials) {
      const rows = await runQuery(
        database,
        dbCredentials,
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

    async findDocumentSourcePath(documentId, dbCredentials) {
      const rows = await runQuery(
        database,
        dbCredentials,
        'CALL "tso"."Web2_GetDocumentSourcePath"(?)',
        [documentId],
      );
      return Array.isArray(rows) ? rows[0] || null : null;
    },
  };
}

module.exports = { createDocumentsRepository };