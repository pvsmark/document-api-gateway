const DOCUMENT_COLUMNS = [
  'DocumentID',
  'FileName',
  'Name',
  'Ext',
];

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

function buildFilters(clientId, filters) {
  const clauses = ['documents.ClientMasterID = ?'];
  const params = [clientId];

  if (filters.search) {
    const pattern = `%${filters.search}%`;
    clauses.push(`(
      documents.FileName LIKE ? OR documents.Name LIKE ? OR documents.DocumentType LIKE ? OR
      documents.Prop LIKE ? OR documents.Parcel LIKE ? OR documents.OwnerName LIKE ? OR
      documents.Account LIKE ? OR documents.LocationCode LIKE ? OR
      CAST(documents.DocumentID AS VARCHAR(30)) LIKE ? OR
      CAST(documents.PropMasterID AS VARCHAR(30)) LIKE ?
    )`);
    params.push(...Array(10).fill(pattern));
  }

  const prefixFields = [
    ['property', 'documents.Prop'],
    ['parcel', 'documents.Parcel'],
    ['account', 'documents.Account'],
    ['state', 'documents.State'],
    ['documentType', 'documents.DocumentType'],
    ['ownerName', 'documents.OwnerName'],
    ['locationCode', 'documents.LocationCode'],
    ['propMasterId', 'documents.PropMasterID'],
  ];
  for (const [name, column] of prefixFields) {
    if (filters[name] !== undefined) {
      clauses.push(`${column} LIKE ?`);
      params.push(`${filters[name]}%`);
    }
  }
  if (filters.assessor !== undefined) {
    clauses.push('(documents.Assessor LIKE ? OR documents.Assessor IS NULL)');
    params.push(`${filters.assessor}%`);
  }
  if (filters.sysYear !== undefined) {
    clauses.push('documents.SysYear = ?');
    params.push(filters.sysYear);
  }
  if (filters.collectorId !== undefined) {
    clauses.push('(documents.CollectorID = ? OR documents.CollectorID IS NULL)');
    params.push(filters.collectorId);
  }
  return { where: clauses.join(' AND '), params };
}

function createArchivesRepository(database) {
  return {
    async findSelectedDocuments(clientId, documentIds) {
      if (!documentIds.length) return [];
      const rows = await database.query(
        `
          SELECT ${DOCUMENT_COLUMNS.join(', ')}
          FROM tso.Web2_WebDocumentListView AS documents
          WHERE documents.ClientMasterID = ?
            AND documents.DocumentID IN (${placeholders(documentIds)})
        `,
        [clientId, ...documentIds],
      );
      return Array.isArray(rows) ? rows : [];
    },

    async findDocumentPage({ clientId, filters, sortSql, offset, limit }) {
      const built = buildFilters(clientId, filters);
      const top = Math.max(1, Number(limit));
      const startAt = Math.max(0, Number(offset)) + 1;
      const rows = await database.query(
        `
          SELECT TOP ${top} START AT ${startAt} ${DOCUMENT_COLUMNS.join(', ')}
          FROM tso.Web2_WebDocumentListView AS documents
          WHERE ${built.where}
          ORDER BY ${sortSql}
        `,
        built.params,
      );
      return Array.isArray(rows) ? rows : [];
    },

    async findSourcePaths(clientId, documentIds) {
      if (!documentIds.length) return [];
      const rows = await database.query(
        'CALL "tso"."Web2_GetDocumentSourcePaths"(?, ?)',
        [clientId, documentIds.join(',')],
      );
      return Array.isArray(rows) ? rows : [];
    },
  };
}

module.exports = { buildFilters, createArchivesRepository };
