'use strict';

jest.mock('../db/knex');
jest.mock('../models/stream-service');
jest.mock('./platforms/twitch-token');

let db = require('../db/knex');
let StreamService = require('../models/stream-service');
let eventBus = require('../events/event-bus');

let TokenRefreshError = require('./token-refresh-error').TokenRefreshError;
let tokenManager;

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();

  // Re-require a fresh module (and fresh singleton) after resetModules
  jest.mock('../db/knex');
  jest.mock('../models/stream-service');
  jest.mock('./platforms/twitch-token');

  tokenManager = require('./token-manager');
  db = require('../db/knex');
  StreamService = require('../models/stream-service');
  TokenRefreshError = require('./token-refresh-error').TokenRefreshError;
  eventBus = require('../events/event-bus');

  eventBus.removeAllListeners();
});

afterEach(() => {
  tokenManager.stop();
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// scheduleRefresh
// ---------------------------------------------------------------------------

describe('scheduleRefresh', () => {
  it('does nothing when api_token_expires_at is null', async () => {
    const svc = { id: 1, platform: 'twitch', api_token_expires_at: null };
    await tokenManager.scheduleRefresh(svc);
    expect(tokenManager.refreshTimers.has(1)).toBe(false);
  });

  it('calls refreshNow immediately when token is already past the refresh window', async () => {
    // expired 2 days ago → past the 24h refresh window
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const svc = { id: 2, platform: 'twitch', api_token_expires_at: past };

    const freshSvc = { ...svc };
    StreamService.getWithCredentials = jest.fn().mockResolvedValue(freshSvc);
    const dbChain = { where: jest.fn().mockReturnThis(), first: jest.fn().mockResolvedValue(null) };
    db.mockReturnValue(dbChain);
    require('./platforms/twitch-token').refresh = jest.fn().mockResolvedValue();

    await tokenManager.scheduleRefresh(svc);

    // refreshNow fetches the service — verify it was called
    expect(StreamService.getWithCredentials).toHaveBeenCalledWith(2);
  });

  it('sets a timer when token expires in the future (> 24h from now)', async () => {
    // expires in 3 days → refresh window is 2 days from now
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const svc = { id: 3, platform: 'kick', api_token_expires_at: future };

    await tokenManager.scheduleRefresh(svc);

    expect(tokenManager.refreshTimers.has(3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// refreshNow — platform dispatch
// ---------------------------------------------------------------------------

describe('refreshNow', () => {
  function setupDbAndSvc(svc) {
    StreamService.getWithCredentials = jest.fn().mockResolvedValue(svc);
    // db is called for re-scheduling after success
    const chain = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue({ ...svc, api_token_expires_at: null }),
      update: jest.fn().mockResolvedValue(1),
    };
    db.mockReturnValue(chain);
    return chain;
  }

  it('calls twitchRefresh for twitch platform', async () => {
    const svc = { id: 10, platform: 'twitch' };
    setupDbAndSvc(svc);
    require('./platforms/twitch-token').refresh = jest.fn().mockResolvedValue();

    await tokenManager.refreshNow(10);

    expect(require('./platforms/twitch-token').refresh).toHaveBeenCalledWith(svc);
  });

  it('calls platform-specific refresh for kick', async () => {
    jest.mock('./platforms/kick-token');
    const kickRefresh = jest.fn().mockResolvedValue();
    require('./platforms/kick-token').refresh = kickRefresh;

    const svc = { id: 11, platform: 'kick' };
    setupDbAndSvc(svc);

    await tokenManager.refreshNow(11);

    expect(kickRefresh).toHaveBeenCalledWith(svc);
  });

  it('calls platform-specific refresh for youtube', async () => {
    jest.mock('./platforms/youtube-token');
    const youtubeRefresh = jest.fn().mockResolvedValue();
    require('./platforms/youtube-token').refresh = youtubeRefresh;

    const svc = { id: 12, platform: 'youtube' };
    setupDbAndSvc(svc);

    await tokenManager.refreshNow(12);

    expect(youtubeRefresh).toHaveBeenCalledWith(svc);
  });

  it('calls platform-specific refresh for joystick', async () => {
    jest.mock('./platforms/joystick-token');
    const joystickRefresh = jest.fn().mockResolvedValue();
    require('./platforms/joystick-token').refresh = joystickRefresh;

    const svc = { id: 13, platform: 'joystick' };
    setupDbAndSvc(svc);

    await tokenManager.refreshNow(13);

    expect(joystickRefresh).toHaveBeenCalledWith(svc);
  });

  it('sets needs_reauth in DB and emits auth.required on TokenRefreshError with requiresReauth', async () => {
    const svc = { id: 20, platform: 'twitch' };
    StreamService.getWithCredentials = jest.fn().mockResolvedValue(svc);
    const chain = {
      where: jest.fn().mockReturnThis(),
      update: jest.fn().mockResolvedValue(1),
    };
    db.mockReturnValue(chain);

    require('./platforms/twitch-token').refresh = jest.fn().mockRejectedValue(
      new TokenRefreshError('Token expired', { requiresReauth: true })
    );

    const authEvents = [];
    eventBus.on('auth.required', (d) => authEvents.push(d));

    await expect(tokenManager.refreshNow(20)).rejects.toThrow(TokenRefreshError);

    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ needs_reauth: true }));
    expect(authEvents).toEqual([{ serviceId: 20, platform: 'twitch' }]);
  });

  it('returns early (no error) when service is not found', async () => {
    StreamService.getWithCredentials = jest.fn().mockResolvedValue(null);
    await expect(tokenManager.refreshNow(999)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

describe('stop', () => {
  it('clears the hourly validation interval', () => {
    tokenManager.validationInterval = setInterval(() => {}, 60000);
    tokenManager.stop();
    expect(tokenManager.validationInterval).toBeNull();
  });

  it('clears all refresh timers', async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    await tokenManager.scheduleRefresh({ id: 30, platform: 'kick', api_token_expires_at: future });
    await tokenManager.scheduleRefresh({ id: 31, platform: 'youtube', api_token_expires_at: future });

    expect(tokenManager.refreshTimers.size).toBe(2);
    tokenManager.stop();
    expect(tokenManager.refreshTimers.size).toBe(0);
  });
});
