'use strict';

/**
 * In-memory cache of TikTok gift metadata, populated by TikTokCapture
 * after WebcastPushConnection.connect() resolves with enableExtendedGiftInfo=true.
 *
 * tiktok-live-connector exposes connection.availableGifts as an array of:
 *   { id, name, diamond_count, image: { url_list: string[] }, ... }
 * (shape varies by version — we read defensively).
 */

const byId = new Map();

function _extractIconUrl(g) {
  const urls = g?.image?.url_list ?? g?.image?.urlList ?? [];
  if (Array.isArray(urls) && urls.length > 0) return urls[0];
  if (typeof g?.icon?.url_list?.[0] === 'string') return g.icon.url_list[0];
  return null;
}

function setAvailableGifts(gifts) {
  if (!Array.isArray(gifts)) return;
  for (const g of gifts) {
    const id = g?.id ?? g?.giftId;
    if (id == null) continue;
    byId.set(String(id), {
      id: String(id),
      name: g.name ?? '',
      diamondCount: g.diamond_count ?? g.diamondCount ?? 0,
      iconUrl: _extractIconUrl(g),
    });
  }
}

function get(giftId) {
  if (giftId == null) return null;
  return byId.get(String(giftId)) ?? null;
}

function all() {
  return Array.from(byId.values());
}

function size() {
  return byId.size;
}

module.exports = { setAvailableGifts, get, all, size };
