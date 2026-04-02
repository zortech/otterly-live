const keytar = require('keytar');
const db = require('../db/knex');

const SERVICE = 'ottery-live';
const CREDENTIAL_FIELDS = [
  'stream_key',
  'api_client_id',
  'api_client_secret',
  'api_access_token',
  'api_refresh_token',
];

// Fields that should never be returned by the API
const CREDENTIAL_FIELD_SET = new Set(CREDENTIAL_FIELDS);

class StreamService {
  static async getCredential(serviceId, field) {
    return keytar.getPassword(SERVICE, `${field}_${serviceId}`);
  }

  static async setCredential(serviceId, field, value) {
    if (value === null || value === undefined || value === '') {
      return keytar.deletePassword(SERVICE, `${field}_${serviceId}`);
    }
    return keytar.setPassword(SERVICE, `${field}_${serviceId}`, String(value));
  }

  static async deleteCredentials(serviceId) {
    await Promise.all(
      CREDENTIAL_FIELDS.map((f) => keytar.deletePassword(SERVICE, `${f}_${serviceId}`))
    );
  }

  // Returns the DB row without credential fields, plus configured status flags
  static async serialize(svc) {
    const { ...safe } = svc;
    for (const field of CREDENTIAL_FIELD_SET) delete safe[field];

    // Add boolean flags so the UI can show "Configured ✓" without exposing values
    const [streamKeySet, accessTokenSet, clientIdSet] = await Promise.all([
      keytar.getPassword(SERVICE, `stream_key_${svc.id}`).then((v) => v !== null),
      keytar.getPassword(SERVICE, `api_access_token_${svc.id}`).then((v) => v !== null),
      keytar.getPassword(SERVICE, `api_client_id_${svc.id}`).then((v) => v !== null),
    ]);

    safe.stream_key_configured = streamKeySet;
    safe.oauth_connected = accessTokenSet;
    safe.api_client_configured = clientIdSet;
    safe.metadata = safe.metadata ? JSON.parse(safe.metadata) : null;

    return safe;
  }

  // Used by restream/capture managers — includes credentials
  static async getWithCredentials(id) {
    const svc = await db('stream_services').where({ id }).first();
    if (!svc) return null;
    const [streamKey, accessToken, refreshToken, clientId, clientSecret] =
      await Promise.all([
        this.getCredential(id, 'stream_key'),
        this.getCredential(id, 'api_access_token'),
        this.getCredential(id, 'api_refresh_token'),
        this.getCredential(id, 'api_client_id'),
        this.getCredential(id, 'api_client_secret'),
      ]);
    return {
      ...svc,
      metadata: svc.metadata ? JSON.parse(svc.metadata) : null,
      stream_key: streamKey,
      api_access_token: accessToken,
      api_refresh_token: refreshToken,
      api_client_id: clientId,
      api_client_secret: clientSecret,
    };
  }
}

module.exports = StreamService;
