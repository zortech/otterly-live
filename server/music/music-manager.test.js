'use strict';

jest.mock('../db/knex');
jest.mock('../settings');
jest.mock('../events/event-bus');
jest.mock('./spotify-client');
jest.mock('./song-queue');

let eventBus = require('../events/event-bus');
let spotify  = require('./spotify-client');
let queue    = require('./song-queue');
let settings = require('../settings');
let db       = require('../db/knex');

let manager;

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeActor(overrides = {}) {
  return {
    platformId: 'user123',
    username: 'testuser',
    displayName: 'TestUser',
    isMod: false,
    isBroadcaster: false,
    ...overrides,
  };
}

function makeChatEvent(message, actorOverrides = {}) {
  return {
    type: 'chat.message',
    platform: 'twitch',
    actor: makeActor(actorOverrides),
    data: { message },
  };
}

const TRACK = {
  id: 'spotify:track:abc',
  name: 'Test Song',
  artists: [{ name: 'Test Artist' }],
  album: { name: 'Test Album', images: [{ url: 'https://example.com/art.jpg' }] },
  duration_ms: 200000,
};

const QUEUE_ITEM = {
  id: 1,
  track_name: 'Test Song',
  artist_name: 'Test Artist',
  status: 'queued',
  position: 1,
};

// Standard settings: music enabled, no credit cost, max 3 per viewer
function mockSettings(overrides = {}) {
  const defaults = {
    'music.enabled': true,
    'music.playbackMode': 'fallback',
    'music.streamPlaylistId': '',
    'music.streamPlaylistShuffle': true,
    'music.interleaveRatio': 3,
    'music.srEnabled': true,
    'music.srCreditCost': 0,
    'music.srMaxQueuePerViewer': 3,
    'music.srBlockDuplicates': true,
    'music.srCommandReply': true,
    'music.pollIntervalMs': 5000,
    'music.songQueueRetentionDays': 180,
    ...overrides,
  };
  settings.get.mockImplementation(async (key) => defaults[key] ?? null);
}

beforeEach(async () => {
  jest.resetModules();

  jest.mock('../db/knex');
  jest.mock('../settings');
  jest.mock('../events/event-bus');
  jest.mock('./spotify-client');
  jest.mock('./song-queue');

  manager  = require('./music-manager');
  eventBus = require('../events/event-bus');
  spotify  = require('./spotify-client');
  queue    = require('./song-queue');
  settings = require('../settings');
  db       = require('../db/knex');

  // Default mocks
  mockSettings();
  spotify.isConnected.mockResolvedValue(true);
  spotify.startPlaylist.mockResolvedValue(undefined);
  spotify.search.mockResolvedValue([TRACK]);
  spotify.getCurrentlyPlaying.mockResolvedValue(null);
  queue.revertAllPlaying.mockResolvedValue(undefined);
  queue.countByUser.mockResolvedValue(0);
  queue.isDuplicate.mockResolvedValue(false);
  queue.add.mockResolvedValue(QUEUE_ITEM);
  queue.getQueue.mockResolvedValue([]);
  queue.removeLastByUser.mockResolvedValue(null);
  queue.remove.mockResolvedValue(null);
  eventBus.emit.mockReturnValue(true);
  eventBus.on.mockReturnValue(eventBus);
  eventBus.off.mockReturnValue(eventBus);

  // Mock db chain for viewer_credits (used when srCreditCost > 0)
  const dbChain = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(1),
    insert: jest.fn().mockResolvedValue([1]),
  };
  db.mockReturnValue(dbChain);
  db.raw = jest.fn((sql, vals) => ({ sql, vals }));
});

afterEach(async () => {
  await manager.stop().catch(() => {});
});

// ── start / stop ───────────────────────────────────────────────────────────────

describe('start', () => {
  it('returns early and registers no handlers when music is disabled', async () => {
    mockSettings({ 'music.enabled': false });
    await manager.start();
    expect(eventBus.on).not.toHaveBeenCalled();
  });

  it('returns early when Spotify is not connected', async () => {
    spotify.isConnected.mockResolvedValue(false);
    await manager.start();
    expect(eventBus.on).not.toHaveBeenCalled();
  });

  it('registers chat event handler when enabled and connected', async () => {
    await manager.start();
    expect(eventBus.on).toHaveBeenCalledWith('event', expect.any(Function));
  });

  it('reverts stuck playing items on start', async () => {
    await manager.start();
    expect(queue.revertAllPlaying).toHaveBeenCalled();
  });
});

describe('stop', () => {
  it('removes the chat event handler', async () => {
    await manager.start();
    await manager.stop();
    expect(eventBus.off).toHaveBeenCalledWith('event', expect.any(Function));
  });
});

// ── !play (handleSongRequest) ──────────────────────────────────────────────────

describe('!play command', () => {
  async function dispatchPlay(message, actorOverrides = {}) {
    await manager.start();
    // Grab the registered chat handler
    const handler = eventBus.on.mock.calls.find((c) => c[0] === 'event')?.[1];
    if (!handler) throw new Error('chat handler not registered');
    handler(makeChatEvent(message, actorOverrides));
    // Allow async command handler to settle
    await new Promise((r) => setTimeout(r, 10));
  }

  it('ignores !play when sr is disabled', async () => {
    mockSettings({ 'music.enabled': true, 'music.srEnabled': false });
    await dispatchPlay('!play test song');
    expect(spotify.search).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('sends usage reply when no search query provided', async () => {
    await dispatchPlay('!play');
    expect(spotify.search).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith('chat.reply', expect.objectContaining({
      message: expect.stringContaining('Usage'),
    }));
  });

  it('sends no-results reply when Spotify returns empty', async () => {
    spotify.search.mockResolvedValue([]);
    await dispatchPlay('!play nonexistent song xyz');
    expect(eventBus.emit).toHaveBeenCalledWith('chat.reply', expect.objectContaining({
      message: expect.stringContaining('No results'),
    }));
  });

  it('emits sr_rejected when track is already queued', async () => {
    queue.isDuplicate.mockResolvedValue(true);
    await dispatchPlay('!play Test Song');
    expect(queue.add).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith('event', expect.objectContaining({
      type: 'music.sr_rejected',
      data: expect.objectContaining({ reason: 'duplicate' }),
    }));
  });

  it('emits sr_rejected when viewer has reached their queue limit', async () => {
    mockSettings({ 'music.enabled': true, 'music.srEnabled': true, 'music.srMaxQueuePerViewer': 1 });
    queue.countByUser.mockResolvedValue(1);
    await dispatchPlay('!play Test Song');
    expect(queue.add).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith('event', expect.objectContaining({
      type: 'music.sr_rejected',
      data: expect.objectContaining({ reason: 'queue_limit' }),
    }));
  });

  it('adds song to queue on successful request', async () => {
    await dispatchPlay('!play Test Song');
    expect(queue.add).toHaveBeenCalledWith(expect.objectContaining({
      trackId: TRACK.id,
      trackName: TRACK.name,
      requesterPlatform: 'twitch',
      requesterUsername: 'testuser',
    }));
    expect(eventBus.emit).toHaveBeenCalledWith('music.request_added', expect.any(Object));
  });

  it('sends confirmation reply after adding song', async () => {
    await dispatchPlay('!play Test Song');
    expect(eventBus.emit).toHaveBeenCalledWith('chat.reply', expect.objectContaining({
      message: expect.stringContaining('Added to queue'),
    }));
  });
});

// ── !remove (handleRemove) ─────────────────────────────────────────────────────

describe('!remove command', () => {
  async function dispatchRemove(message, actorOverrides = {}) {
    await manager.start();
    const handler = eventBus.on.mock.calls.find((c) => c[0] === 'event')?.[1];
    handler(makeChatEvent(message, actorOverrides));
    await new Promise((r) => setTimeout(r, 10));
  }

  it('sends no-songs reply when viewer has nothing to remove', async () => {
    queue.removeLastByUser.mockResolvedValue(null);
    await dispatchRemove('!remove');
    expect(eventBus.emit).toHaveBeenCalledWith('chat.reply', expect.objectContaining({
      message: expect.stringContaining('no songs in the queue'),
    }));
  });

  it('removes and confirms when viewer removes their last request', async () => {
    queue.removeLastByUser.mockResolvedValue(QUEUE_ITEM);
    await dispatchRemove('!remove');
    expect(eventBus.emit).toHaveBeenCalledWith('chat.reply', expect.objectContaining({
      message: expect.stringContaining('Removed'),
    }));
    expect(eventBus.emit).toHaveBeenCalledWith('music.request_removed', expect.any(Object));
  });

  it('allows mod to remove by position', async () => {
    queue.getQueue.mockResolvedValue([QUEUE_ITEM, { ...QUEUE_ITEM, id: 2, position: 2 }]);
    queue.remove.mockResolvedValue(QUEUE_ITEM);
    await dispatchRemove('!remove 1', { isMod: true });
    expect(queue.remove).toHaveBeenCalledWith(QUEUE_ITEM.id);
  });

  it('sends no-position reply when mod provides out-of-range position', async () => {
    queue.getQueue.mockResolvedValue([QUEUE_ITEM]);
    await dispatchRemove('!remove 99', { isMod: true });
    expect(eventBus.emit).toHaveBeenCalledWith('chat.reply', expect.objectContaining({
      message: expect.stringContaining('No song at position'),
    }));
  });
});

// ── !song (handleNowPlaying) ───────────────────────────────────────────────────

describe('!song command', () => {
  async function dispatchSong(message = '!song') {
    await manager.start();
    const handler = eventBus.on.mock.calls.find((c) => c[0] === 'event')?.[1];
    handler(makeChatEvent(message));
    await new Promise((r) => setTimeout(r, 10));
  }

  it('replies "nothing playing" when Spotify is idle', async () => {
    spotify.getCurrentlyPlaying.mockResolvedValue(null);
    await dispatchSong();
    expect(eventBus.emit).toHaveBeenCalledWith('chat.reply', expect.objectContaining({
      message: expect.stringContaining('Nothing is playing'),
    }));
  });

  it('replies with current track when something is playing', async () => {
    spotify.getCurrentlyPlaying.mockResolvedValue({ item: TRACK });
    await dispatchSong();
    expect(eventBus.emit).toHaveBeenCalledWith('chat.reply', expect.objectContaining({
      message: expect.stringContaining('Now playing'),
    }));
  });
});

// ── !queue (handleQueueCommand) ────────────────────────────────────────────────

describe('!queue command', () => {
  async function dispatchQueue() {
    await manager.start();
    const handler = eventBus.on.mock.calls.find((c) => c[0] === 'event')?.[1];
    handler(makeChatEvent('!queue'));
    await new Promise((r) => setTimeout(r, 10));
  }

  it('replies "empty" when queue has no items', async () => {
    queue.getQueue.mockResolvedValue([]);
    await dispatchQueue();
    expect(eventBus.emit).toHaveBeenCalledWith('chat.reply', expect.objectContaining({
      message: expect.stringContaining('empty'),
    }));
  });

  it('lists up to 5 songs in the reply', async () => {
    queue.getQueue.mockResolvedValue([
      { track_name: 'Song A', artist_name: 'Artist A' },
      { track_name: 'Song B', artist_name: 'Artist B' },
    ]);
    await dispatchQueue();
    expect(eventBus.emit).toHaveBeenCalledWith('chat.reply', expect.objectContaining({
      message: expect.stringContaining('Song A'),
    }));
  });
});

// ── !skip (handleSkip) ─────────────────────────────────────────────────────────

describe('!skip command', () => {
  async function dispatchSkip(actorOverrides = {}) {
    await manager.start();
    const handler = eventBus.on.mock.calls.find((c) => c[0] === 'event')?.[1];
    handler(makeChatEvent('!skip', actorOverrides));
    await new Promise((r) => setTimeout(r, 10));
  }

  it('denies skip to non-admin viewer', async () => {
    await dispatchSkip({ isMod: false, isBroadcaster: false });
    expect(spotify.skipToNext).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith('chat.reply', expect.objectContaining({
      message: expect.stringContaining('Only the streamer'),
    }));
  });

  it('allows broadcaster to skip', async () => {
    spotify.skipToNext = jest.fn().mockResolvedValue(undefined);
    await dispatchSkip({ isBroadcaster: true });
    expect(spotify.skipToNext).toHaveBeenCalled();
  });
});

// ── non-command events are ignored ────────────────────────────────────────────

describe('non-command chat events', () => {
  it('ignores plain chat messages with no command prefix', async () => {
    await manager.start();
    const handler = eventBus.on.mock.calls.find((c) => c[0] === 'event')?.[1];
    handler(makeChatEvent('hello world'));
    await new Promise((r) => setTimeout(r, 10));
    expect(spotify.search).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('ignores non-chat.message events', async () => {
    await manager.start();
    const handler = eventBus.on.mock.calls.find((c) => c[0] === 'event')?.[1];
    handler({ type: 'follow', platform: 'twitch', actor: makeActor(), data: {} });
    await new Promise((r) => setTimeout(r, 10));
    expect(spotify.search).not.toHaveBeenCalled();
  });
});
