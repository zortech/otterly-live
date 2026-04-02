'use strict';

// In-memory keytar mock for Jest tests
const store = new Map();

module.exports = {
  async getPassword(service, account) {
    return store.get(`${service}::${account}`) ?? null;
  },
  async setPassword(service, account, password) {
    store.set(`${service}::${account}`, password);
  },
  async deletePassword(service, account) {
    return store.delete(`${service}::${account}`);
  },
  async findCredentials(service) {
    const results = [];
    for (const [key, password] of store) {
      const [svc, account] = key.split('::');
      if (svc === service) results.push({ account, password });
    }
    return results;
  },
  _store: store,
  _clear() { store.clear(); },
};
