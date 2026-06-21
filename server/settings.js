const keytar = require('keytar');
const db = require('./db/knex');

const KEYCHAIN_SERVICE = 'ottery-live-settings';

const KEYCHAIN_KEYS = new Set(['rtmp.incomingKey', 'streamtap.authToken', 'relay.apiToken']);

const DEFAULTS = {
  'rtmp.port': 1935,
  'server.port': 3737,
  'server.bindAddress': '127.0.0.1',
  'stream.autoStartOnOBSConnect': true,
  'stream.stopCaptureOnStreamEnd': false,
  'app.minimizeToTray': true,
  'app.checkForUpdates': true,
  'app.logLevel': 'info',
  'rtmp.incomingKey': 'ottery',
  'credits.enabled': true,
  'credits.nameSingular': 'credit',
  'credits.perChatMinute': 10,
  'credits.giftMultiplier': 2.0,
  'credits.transactionRetentionDays': 180,
  'credits.apiKey': '',
  'warudo.enabled': false,
  'warudo.host': 'localhost',
  'warudo.port': 19190,
  'streamtap.enabled': false,
  'streamtap.port': 4747,
  'streamtap.mdns': true,
  'streamtap.authToken': '',
  'relay.mode': 'local',
  'relay.url': '',
  'relay.apiToken': '',
  'relay.caCert': '',            // PEM to pin a self-signed relay cert (preferred)
  'relay.allowSelfSigned': false, // escape hatch: disable TLS verification (MITM-unsafe)
};

const cache = new Map();

const settings = {
  async get(key) {
    if (cache.has(key)) return cache.get(key);

    let value;
    if (KEYCHAIN_KEYS.has(key)) {
      value = (await keytar.getPassword(KEYCHAIN_SERVICE, key)) ?? DEFAULTS[key] ?? null;
    } else {
      const row = await db('settings').where({ key }).first();
      value = row ? JSON.parse(row.value) : (DEFAULTS[key] ?? null);
    }

    cache.set(key, value);
    return value;
  },

  async set(key, value) {
    cache.delete(key);
    if (KEYCHAIN_KEYS.has(key)) {
      await keytar.setPassword(KEYCHAIN_SERVICE, key, String(value));
      return;
    }
    await db('settings')
      .insert({ key, value: JSON.stringify(value) })
      .onConflict('key').merge();
  },

  async getAll() {
    const rows = await db('settings');
    const result = { ...DEFAULTS };
    for (const row of rows) {
      if (!KEYCHAIN_KEYS.has(row.key)) result[row.key] = JSON.parse(row.value);
    }
    return result;
  },

  async getPublic() {
    const all = await this.getAll();
    return Object.fromEntries(
      Object.entries(all).filter(([k]) => !KEYCHAIN_KEYS.has(k))
    );
  },
};

module.exports = settings;
