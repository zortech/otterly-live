'use strict';

// Mock external dependencies
jest.mock('ws');
jest.mock('../db/knex', () => ({}));
jest.mock('../models/stream-service');
jest.mock('../auth/token-manager', () => ({ refreshNow: jest.fn() }));

const EventEmitter = require('events');
const WebSocket = require('ws');
const StreamService = require('../models/stream-service');
const TwitchCapture = require('./twitch');

// Fake manager: provides buildEvent used by BaseCapture
const fakeManager = {
  buildEvent(platform, type, actor, data) {
    return { platform, type, actor, data };
  },
};

function makeSvc(overrides = {}) {
  return {
    id: 1,
    platform: 'twitch',
    api_access_token: 'token-abc',
    api_client_id: 'client-xyz',
    metadata: { channel_id: 'ch123' },
    ...overrides,
  };
}

function makeWsStub() {
  const ws = new EventEmitter();
  ws.readyState = WebSocket.OPEN;
  ws.send  = jest.fn();
  ws.close = jest.fn();
  return ws;
}

// ── connect() guard conditions ─────────────────────────────────────────────────

describe('connect() guards', () => {
  beforeEach(() => {
    StreamService.getWithCredentials = jest.fn().mockResolvedValue(makeSvc());
  });

  it('emits error with NO_TOKEN when api_access_token is missing', async () => {
    StreamService.getWithCredentials.mockResolvedValue(makeSvc({ api_access_token: null }));
    const capture = new TwitchCapture(makeSvc(), fakeManager);
    const errors = [];
    capture.on('error', (e) => errors.push(e));

    await capture.connect();

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('NO_TOKEN');
    expect(WebSocket).not.toHaveBeenCalled();
  });

  it('emits error with NO_CLIENT_ID when api_client_id is missing', async () => {
    StreamService.getWithCredentials.mockResolvedValue(makeSvc({ api_client_id: null }));
    const capture = new TwitchCapture(makeSvc(), fakeManager);
    const errors = [];
    capture.on('error', (e) => errors.push(e));

    await capture.connect();

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('NO_CLIENT_ID');
    expect(WebSocket).not.toHaveBeenCalled();
  });

  it('emits error with NO_CHANNEL_ID when metadata.channel_id is missing', async () => {
    StreamService.getWithCredentials.mockResolvedValue(makeSvc({ metadata: {} }));
    const capture = new TwitchCapture(makeSvc(), fakeManager);
    const errors = [];
    capture.on('error', (e) => errors.push(e));

    await capture.connect();

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('NO_CHANNEL_ID');
    expect(WebSocket).not.toHaveBeenCalled();
  });

  it('opens a WebSocket when all credentials are present', async () => {
    const wsStub = makeWsStub();
    WebSocket.mockReturnValue(wsStub);

    const capture = new TwitchCapture(makeSvc(), fakeManager);
    await capture.connect();

    expect(WebSocket).toHaveBeenCalledWith(expect.stringContaining('eventsub.wss.twitch.tv'));
  });
});

// ── _normalizeEvent ────────────────────────────────────────────────────────────
// Instantiate directly with a stubbed svc (no connect() call needed)

describe('_normalizeEvent', () => {
  let capture;
  beforeEach(() => {
    capture = new TwitchCapture(makeSvc(), fakeManager);
  });

  it('normalizes channel.chat.message', () => {
    const result = capture._normalizeEvent('channel.chat.message', {
      chatter_user_id: 'u1',
      chatter_user_login: 'user1',
      chatter_user_name: 'User1',
      badges: [{ set_id: 'subscriber' }],
      message: { text: 'hello world', fragments: [{ type: 'text', text: 'hello world' }] },
      color: '#FF0000',
    });
    expect(result.type).toBe('chat.message');
    expect(result.actor.platformId).toBe('u1');
    expect(result.actor.isSubscriber).toBe(true);
    expect(result.actor.isModerator).toBe(false);
    expect(result.data.message).toBe('hello world');
    expect(result.data.color).toBe('#FF0000');
  });

  it('normalizes channel.follow', () => {
    const result = capture._normalizeEvent('channel.follow', {
      user_id: 'f1', user_login: 'follower1', user_name: 'Follower1',
    });
    expect(result.type).toBe('follow');
    expect(result.actor.platformId).toBe('f1');
    expect(result.actor.username).toBe('follower1');
  });

  it('normalizes channel.subscribe', () => {
    const result = capture._normalizeEvent('channel.subscribe', {
      user_id: 's1', user_login: 'subber1', user_name: 'Subber1',
      tier: '1000', is_gift: false,
    });
    expect(result.type).toBe('subscribe');
    expect(result.data.tier).toBe('1000');
    expect(result.data.isGift).toBe(false);
  });

  it('normalizes channel.subscription.gift (named gifter)', () => {
    const result = capture._normalizeEvent('channel.subscription.gift', {
      user_id: 'g1', user_login: 'gifter1', user_name: 'Gifter1',
      is_anonymous: false, total: 5, tier: '1000', cumulative_total: 20,
    });
    expect(result.type).toBe('subscribe.gift');
    expect(result.actor.platformId).toBe('g1');
    expect(result.data.count).toBe(5);
    expect(result.data.totalGifted).toBe(20);
  });

  it('normalizes channel.subscription.gift (anonymous gifter)', () => {
    const result = capture._normalizeEvent('channel.subscription.gift', {
      is_anonymous: true, total: 1, tier: '1000',
    });
    expect(result.type).toBe('subscribe.gift');
    expect(result.actor).toBeNull();
  });

  it('normalizes channel.cheer', () => {
    const result = capture._normalizeEvent('channel.cheer', {
      user_id: 'c1', user_login: 'cheerer1', user_name: 'Cheerer1',
      is_anonymous: false, bits: 100, message: 'cheer100 GG',
    });
    expect(result.type).toBe('cheer');
    expect(result.data.bits).toBe(100);
    expect(result.data.message).toBe('cheer100 GG');
  });

  it('normalizes channel.cheer (anonymous)', () => {
    const result = capture._normalizeEvent('channel.cheer', {
      is_anonymous: true, bits: 50, message: null,
    });
    expect(result.type).toBe('cheer');
    expect(result.actor).toBeNull();
  });

  it('normalizes channel.raid', () => {
    const result = capture._normalizeEvent('channel.raid', {
      from_broadcaster_user_id: 'r1',
      from_broadcaster_user_login: 'raider1',
      from_broadcaster_user_name: 'Raider1',
      viewers: 250,
    });
    expect(result.type).toBe('raid');
    expect(result.actor.platformId).toBe('r1');
    expect(result.data.viewers).toBe(250);
  });

  it('normalizes channel.channel_points_custom_reward_redemption.add', () => {
    const result = capture._normalizeEvent(
      'channel.channel_points_custom_reward_redemption.add',
      {
        user_id: 'rd1', user_login: 'redeemer1', user_name: 'Redeemer1',
        reward: { title: 'Hydrate', cost: 500 },
        user_input: 'drinking now',
      }
    );
    expect(result.type).toBe('redeem');
    expect(result.data.rewardTitle).toBe('Hydrate');
    expect(result.data.rewardCost).toBe(500);
    expect(result.data.input).toBe('drinking now');
  });

  it('normalizes stream.online to stream.start', () => {
    const result = capture._normalizeEvent('stream.online', { title: 'Gaming Today' });
    expect(result.type).toBe('stream.start');
    expect(result.data.title).toBe('Gaming Today');
  });

  it('normalizes stream.offline to stream.end', () => {
    const result = capture._normalizeEvent('stream.offline', {});
    expect(result.type).toBe('stream.end');
    expect(result.actor).toBeNull();
  });

  it('returns null for unknown subscription types', () => {
    expect(capture._normalizeEvent('channel.unknown.event', {})).toBeNull();
  });
});

// ── _handleNotification ────────────────────────────────────────────────────────

describe('_handleNotification', () => {
  it('emits an event for a known subscription type', () => {
    const capture = new TwitchCapture(makeSvc(), fakeManager);
    const emitted = [];
    capture.on('event', (e) => emitted.push(e));

    capture._handleNotification({
      metadata: { subscription_type: 'channel.follow' },
      payload: {
        event: { user_id: 'u1', user_login: 'user1', user_name: 'User1' },
      },
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('follow');
  });

  it('does not emit for messages missing metadata or event', () => {
    const capture = new TwitchCapture(makeSvc(), fakeManager);
    const emitted = [];
    capture.on('event', (e) => emitted.push(e));

    capture._handleNotification({ metadata: {}, payload: {} });
    capture._handleNotification({});

    expect(emitted).toHaveLength(0);
  });
});
