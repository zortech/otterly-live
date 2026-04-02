'use strict';

jest.mock('ws');
jest.mock('../db/knex', () => ({}));
jest.mock('../models/stream-service');
jest.mock('../auth/token-manager', () => ({ refreshNow: jest.fn() }));

const EventEmitter = require('events');
const WebSocket = require('ws');
const StreamService = require('../models/stream-service');
const KickCapture = require('./kick');

const fakeManager = {
  buildEvent(platform, type, actor, data) {
    return { platform, type, actor, data };
  },
};

function makeSvc(overrides = {}) {
  return {
    id: 1,
    platform: 'kick',
    username: 'testchannel',
    metadata: { chatroom_id: 123456 },
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

// ── connect() guards ───────────────────────────────────────────────────────────

describe('connect() guards', () => {
  beforeEach(() => {
    StreamService.getWithCredentials = jest.fn().mockResolvedValue(makeSvc());
  });

  it('emits error with NO_USERNAME when username is missing', async () => {
    StreamService.getWithCredentials.mockResolvedValue(makeSvc({ username: null }));
    const capture = new KickCapture(makeSvc(), fakeManager);
    const errors = [];
    capture.on('error', (e) => errors.push(e));

    await capture.connect();

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('NO_USERNAME');
    expect(WebSocket).not.toHaveBeenCalled();
  });

  it('emits error with NO_CHATROOM_ID when chatroom_id is missing and fetch fails', async () => {
    StreamService.getWithCredentials.mockResolvedValue(makeSvc({ metadata: {} }));
    // Stub the internal fetch helper
    const capture = new KickCapture(makeSvc({ metadata: {} }), fakeManager);
    capture._fetchAndStoreChatroomId = jest.fn().mockResolvedValue(null);
    const errors = [];
    capture.on('error', (e) => errors.push(e));

    await capture.connect();

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('NO_CHATROOM_ID');
  });

  it('opens a WebSocket when chatroom_id is present in metadata', async () => {
    const wsStub = makeWsStub();
    WebSocket.mockReturnValue(wsStub);

    const capture = new KickCapture(makeSvc(), fakeManager);
    await capture.connect();

    expect(WebSocket).toHaveBeenCalledWith(expect.stringContaining('pusher.com'));
  });
});

// ── _normalizeEvent ────────────────────────────────────────────────────────────

describe('_normalizeEvent', () => {
  let capture;
  beforeEach(() => {
    capture = new KickCapture(makeSvc(), fakeManager);
  });

  it('normalizes ChatMessage', () => {
    const result = capture._normalizeEvent('ChatMessage', {
      content: 'Hello!',
      sender: {
        id: 99,
        slug: 'viewer1',
        username: 'Viewer1',
        identity: {
          color: '#00AAFF',
          badges: [{ type: 'subscriber' }],
        },
      },
    });
    expect(result.type).toBe('chat.message');
    expect(result.actor.platformId).toBe('99');
    expect(result.actor.username).toBe('viewer1');
    expect(result.actor.displayName).toBe('Viewer1');
    expect(result.actor.isSubscriber).toBe(true);
    expect(result.actor.isModerator).toBe(false);
    expect(result.data.message).toBe('Hello!');
    expect(result.data.color).toBe('#00AAFF');
  });

  it('normalizes Subscription', () => {
    const result = capture._normalizeEvent('Subscription', {
      username: 'subber1',
      months: 3,
    });
    expect(result.type).toBe('subscribe');
    expect(result.actor.username).toBe('subber1');
    expect(result.data.months).toBe(3);
  });

  it('normalizes GiftedSubscriptions with gifter', () => {
    const result = capture._normalizeEvent('GiftedSubscriptions', {
      gifter_username: 'gifter1',
      gifted_usernames: ['a', 'b', 'c'],
      gifter_total: 10,
    });
    expect(result.type).toBe('subscribe.gift');
    expect(result.actor.username).toBe('gifter1');
    expect(result.data.count).toBe(3);
    expect(result.data.totalGifted).toBe(10);
  });

  it('normalizes GiftedSubscriptions with anonymous gifter', () => {
    const result = capture._normalizeEvent('GiftedSubscriptions', {
      gifted_usernames: ['x'],
    });
    expect(result.type).toBe('subscribe.gift');
    expect(result.actor).toBeNull();
    expect(result.data.count).toBe(1);
  });

  it('normalizes StreamerIsLive', () => {
    const result = capture._normalizeEvent('StreamerIsLive', {
      livestream: { session_title: 'Let\'s game!' },
    });
    expect(result.type).toBe('stream.start');
    expect(result.data.title).toBe('Let\'s game!');
  });

  it('normalizes StreamEnd', () => {
    const result = capture._normalizeEvent('StreamEnd', {});
    expect(result.type).toBe('stream.end');
    expect(result.actor).toBeNull();
  });

  it('normalizes ViewerCount', () => {
    const result = capture._normalizeEvent('ViewerCount', { viewers: 1234 });
    expect(result.type).toBe('viewer_count');
    expect(result.data.count).toBe(1234);
  });

  it('returns null for noise events (MessageDeleted, UserBanned, etc.)', () => {
    const noiseEvents = [
      'MessageDeleted', 'UserBanned', 'UserUnBanned', 'PollUpdate', 'PollDelete',
      'LuckyUsersWhoGotGiftSubscriptions', 'GiftsLeaderboardUpdated',
      'PinnedMessageCreated', 'PinnedMessageDeleted', 'ChatroomClear',
      'StreamHost', 'ChatMoveToSupportedChannel',
    ];
    for (const evt of noiseEvents) {
      expect(capture._normalizeEvent(evt, {})).toBeNull();
    }
  });

  it('returns null for unknown events', () => {
    expect(capture._normalizeEvent('SomeFutureEvent', {})).toBeNull();
  });
});

// ── _onMessage routing ─────────────────────────────────────────────────────────

describe('_onMessage routing', () => {
  let capture;
  beforeEach(() => {
    capture = new KickCapture(makeSvc(), fakeManager);
    capture._chatroomChannel = 'chatrooms.123456.v2';
    capture._ws = makeWsStub();
  });

  it('subscribes to chatroom on pusher:connection_established', () => {
    capture._onMessage(JSON.stringify({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'abc', activity_timeout: 120 }),
    }));
    expect(capture._ws.send).toHaveBeenCalledWith(
      expect.stringContaining('pusher:subscribe')
    );
  });

  it('emits an event for platform ChatMessage events', () => {
    const emitted = [];
    capture.on('event', (e) => emitted.push(e));

    capture._onMessage(JSON.stringify({
      event: 'ChatMessage',
      data: JSON.stringify({
        content: 'hey',
        sender: {
          id: 1, slug: 'user1', username: 'User1',
          identity: { color: null, badges: [] },
        },
      }),
    }));

    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('chat.message');
  });

  it('responds to pusher:ping with pong', () => {
    capture._onMessage(JSON.stringify({ event: 'pusher:ping', data: {} }));
    expect(capture._ws.send).toHaveBeenCalledWith(
      expect.stringContaining('pusher:pong')
    );
  });

  it('emits error on pusher:error', () => {
    const errors = [];
    capture.on('error', (e) => errors.push(e));

    capture._onMessage(JSON.stringify({
      event: 'pusher:error',
      data: JSON.stringify({ message: 'Rate limit exceeded', code: 4201 }),
    }));

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Rate limit exceeded');
  });

  it('does not throw on malformed JSON', () => {
    expect(() => capture._onMessage('not json at all')).not.toThrow();
  });
});

// ── disconnect ─────────────────────────────────────────────────────────────────

describe('disconnect', () => {
  it('closes WebSocket and emits disconnected', async () => {
    const wsStub = makeWsStub();
    const capture = new KickCapture(makeSvc(), fakeManager);
    capture._ws = wsStub;

    const events = [];
    capture.on('disconnected', (e) => events.push(e));

    await capture.disconnect();

    expect(wsStub.close).toHaveBeenCalledWith(1000, 'intentional disconnect');
    expect(events[0].reason).toBe('intentional');
  });
});
