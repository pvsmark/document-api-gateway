function createGeneratedReportsService({ storage }) {
  return {
    upload(values, input, options = {}) {
      return storage.persist(values, input, options);
    },

    async get(values) {
      const prepared = await storage.prepare(values);
      return {
        summaryId: values.summaryId,
        clientId: values.clientId,
        currentYear: values.currentYear,
        size: prepared.size,
        createReadStream: prepared.createReadStream,
      };
    },
  };
}

module.exports = { createGeneratedReportsService };