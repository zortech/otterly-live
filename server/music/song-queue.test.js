'use strict';

jest.mock('../db/knex');

let db = require('../db/knex');
let queue;

/**
 * Returns a chainable knex query-builder mock.
 * - chainMethods (.where, .whereIn, .orderBy, .max, .count) return `this`
 * - terminalValues override the terminal call return values
 *
 * For queries that do NOT end in .first() (e.g. getQueue returns orderBy result),
 * pass `rows` to make .orderBy() resolve to an array instead of chaining.
 */
function makeChain({ first, insert, update, deleteCount, rows } = {}) {
  const chain = {
    where:   jest.fn().mockReturnThis(),
    whereIn: jest.fn().mockReturnThis(),
    max:     jest.fn().mockReturnThis(),
    count:   jest.fn().mockReturnThis(),
    first:   jest.fn().mockResolvedValue(first),
    insert:  jest.fn().mockResolvedValue(insert ?? [1]),
    update:  jest.fn().mockResolvedValue(update ?? 1),
    delete:  jest.fn().mockResolvedValue(deleteCount ?? 0),
  };

  if (rows !== undefined) {
    chain.orderBy = jest.fn().mockResolvedValue(rows);
  } else {
    chain.orderBy = jest.fn().mockReturnThis();
  }

  return chain;
}

const TRACK_INPUT = {
  trackId: 'spotify:track:abc123',
  trackName: 'Test Song',
  artistName: 'Test Artist',
  albumName: 'Test Album',
  albumArtUrl: 'https://example.com/art.jpg',
  durationMs: 210000,
  requesterPlatform: 'twitch',
  requesterPlatformUserId: 'user123',
  requesterUsername: 'testuser',
  requesterDisplayName: 'TestUser',
};

const QUEUED_ITEM = {
  id: 1,
  spotify_track_id: 'spotify:track:abc123',
  track_name: 'Test Song',
  artist_name: 'Test Artist',
  status: 'queued',
  position: 1,
  credits_spent: 0,
  requester_platform: 'twitch',
  requester_platform_user_id: 'user123',
  twitch_redemption_id: null,
  twitch_reward_id: null,
};

beforeEach(() => {
  jest.resetModules();
  jest.mock('../db/knex');
  queue = require('./song-queue');
  db = require('../db/knex');  // fresh mock after resetModules
  db.mockReset();
  db.transaction = jest.fn();
});

// ── add ────────────────────────────────────────────────────────────────────────

describe('add', () => {
  it('inserts with position 1 when queue is empty', async () => {
    const maxChain    = makeChain({ first: { m: null } });
    const insertChain = makeChain({ insert: [1] });
    const fetchChain  = makeChain({ first: QUEUED_ITEM });
    db.mockReturnValueOnce(maxChain)
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(fetchChain);

    const result = await queue.add(TRACK_INPUT);

    expect(result).toEqual(QUEUED_ITEM);
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        spotify_track_id: TRACK_INPUT.trackId,
        track_name: TRACK_INPUT.trackName,
        status: 'queued',
        position: 1,
      })
    );
  });

  it('appends after the current highest position', async () => {
    const maxChain    = makeChain({ first: { m: 4 } });
    const insertChain = makeChain({ insert: [5] });
    const fetchChain  = makeChain({ first: { ...QUEUED_ITEM, id: 5, position: 5 } });
    db.mockReturnValueOnce(maxChain)
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(fetchChain);

    await queue.add(TRACK_INPUT);

    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ position: 5 })
    );
  });

  it('sets source and creditsCost when provided', async () => {
    const maxChain    = makeChain({ first: { m: 0 } });
    const insertChain = makeChain({ insert: [1] });
    const fetchChain  = makeChain({ first: QUEUED_ITEM });
    db.mockReturnValueOnce(maxChain)
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(fetchChain);

    await queue.add({ ...TRACK_INPUT, source: 'request', creditsCost: 50 });

    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'request', credits_spent: 50 })
    );
  });
});

// ── remove ─────────────────────────────────────────────────────────────────────

describe('remove', () => {
  it('returns null when item does not exist', async () => {
    db.mockReturnValue(makeChain({ first: undefined }));
    expect(await queue.remove(999)).toBeNull();
  });

  it('returns null when item is already playing', async () => {
    db.mockReturnValue(makeChain({ first: { ...QUEUED_ITEM, status: 'playing' } }));
    expect(await queue.remove(1)).toBeNull();
  });

  it('returns null when item is already played', async () => {
    db.mockReturnValue(makeChain({ first: { ...QUEUED_ITEM, status: 'played' } }));
    expect(await queue.remove(1)).toBeNull();
  });

  it('marks the item as removed and returns it', async () => {
    const fetchChain  = makeChain({ first: QUEUED_ITEM });
    const updateChain = makeChain({ update: 1 });
    db.mockReturnValueOnce(fetchChain).mockReturnValueOnce(updateChain);

    const result = await queue.remove(1);

    expect(result).toEqual(QUEUED_ITEM);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'removed' })
    );
  });
});

// ── removeLastByUser ───────────────────────────────────────────────────────────

describe('removeLastByUser', () => {
  it('returns null when user has no queued items', async () => {
    const chain = makeChain({ first: undefined });
    db.mockReturnValue(chain);
    expect(await queue.removeLastByUser('twitch', 'user123')).toBeNull();
  });

  it('removes and returns the most recent queued item for the user', async () => {
    const fetchChain  = makeChain({ first: QUEUED_ITEM });
    const updateChain = makeChain({ update: 1 });
    db.mockReturnValueOnce(fetchChain).mockReturnValueOnce(updateChain);

    const result = await queue.removeLastByUser('twitch', 'user123');
    expect(result).toEqual(QUEUED_ITEM);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'removed' })
    );
  });
});

// ── countByUser ────────────────────────────────────────────────────────────────

describe('countByUser', () => {
  it('returns the count of queued items for a user', async () => {
    db.mockReturnValue(makeChain({ first: { c: 3 } }));
    expect(await queue.countByUser('twitch', 'user123')).toBe(3);
  });

  it('returns 0 when user has no queued songs', async () => {
    db.mockReturnValue(makeChain({ first: { c: 0 } }));
    expect(await queue.countByUser('twitch', 'newuser')).toBe(0);
  });

  it('returns 0 when query returns null', async () => {
    db.mockReturnValue(makeChain({ first: null }));
    expect(await queue.countByUser('twitch', 'ghost')).toBe(0);
  });
});

// ── isDuplicate ────────────────────────────────────────────────────────────────

describe('isDuplicate', () => {
  it('returns true when the track is already queued', async () => {
    db.mockReturnValue(makeChain({ first: QUEUED_ITEM }));
    expect(await queue.isDuplicate('spotify:track:abc123')).toBe(true);
  });

  it('returns false when the track is not in the queue', async () => {
    db.mockReturnValue(makeChain({ first: undefined }));
    expect(await queue.isDuplicate('spotify:track:new')).toBe(false);
  });
});

// ── markPlaying / markPlayed / revertToQueued ──────────────────────────────────

describe('status transitions', () => {
  it('markPlaying updates status to playing', async () => {
    const chain = makeChain({ update: 1 });
    db.mockReturnValue(chain);
    await queue.markPlaying(1);
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'playing' }));
  });

  it('markPlayed updates status to played', async () => {
    const chain = makeChain({ update: 1 });
    db.mockReturnValue(chain);
    await queue.markPlayed(1);
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'played' }));
  });

  it('revertToQueued sets status back to queued', async () => {
    const chain = makeChain({ update: 1 });
    db.mockReturnValue(chain);
    await queue.revertToQueued(1);
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' }));
  });
});

// ── getQueue ───────────────────────────────────────────────────────────────────

describe('getQueue', () => {
  it('returns queued and playing items ordered by position', async () => {
    const items = [QUEUED_ITEM, { ...QUEUED_ITEM, id: 2, position: 2 }];
    const chain = {
      whereIn: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockResolvedValue(items),
    };
    db.mockReturnValue(chain);

    const result = await queue.getQueue();
    expect(result).toHaveLength(2);
    expect(chain.whereIn).toHaveBeenCalledWith('status', ['queued', 'playing']);
    expect(chain.orderBy).toHaveBeenCalledWith('position', 'asc');
  });

  it('returns empty array when queue is empty', async () => {
    const chain = {
      whereIn: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockResolvedValue([]),
    };
    db.mockReturnValue(chain);
    expect(await queue.getQueue()).toEqual([]);
  });
});

// ── bump ───────────────────────────────────────────────────────────────────────

describe('bump', () => {
  it('returns false when the item does not exist or is not queued', async () => {
    db.mockReturnValue(makeChain({ first: undefined }));
    expect(await queue.bump(99, 'up')).toBe(false);
  });

  it('returns false when trying to move the first item up', async () => {
    const item = { ...QUEUED_ITEM, id: 1, position: 1 };
    db.mockReturnValueOnce(makeChain({ first: item }))
      .mockReturnValueOnce({ where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockResolvedValue([item]) });
    expect(await queue.bump(1, 'up')).toBe(false);
  });

  it('swaps positions when moving an item up', async () => {
    const item1 = { ...QUEUED_ITEM, id: 1, position: 1 };
    const item2 = { ...QUEUED_ITEM, id: 2, position: 2, status: 'queued' };

    const trxChain = { where: jest.fn().mockReturnThis(), update: jest.fn().mockResolvedValue(1) };
    const trx = jest.fn().mockReturnValue(trxChain);

    db.mockReturnValueOnce(makeChain({ first: item2 }))
      .mockReturnValueOnce({ where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockResolvedValue([item1, item2]) });
    db.transaction = jest.fn().mockImplementation(async (fn) => fn(trx));

    const result = await queue.bump(2, 'up');
    expect(result).toBe(true);
    expect(trxChain.update).toHaveBeenCalledTimes(2);
  });
});
