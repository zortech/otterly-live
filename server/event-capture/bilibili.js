'use strict';

// Requires: npm install bilibili-live-ws
const { LiveWS } = require('bilibili-live-ws');
const BaseCapture = require('./base-capture');
const StreamService = require('../models/stream-service');
const logger = require('../lib/logger');

const DANMU_INFO_API = 'https://api.live.bilibili.com/room/v1/Danmu/getConf';

// GUARD_BUY guard_level → normalized tier name
const GUARD_TIER = { 1: 'governor', 2: 'admiral', 3: 'captain' };

class BilibiliCapture extends BaseCapture {
  constructor(svc, manager) {
    super(svc, manager);
    this._ws = null;
    this._intentionalDisconnect = false;
  }

  async connect() {
    try {
      this.svc = await StreamService.getWithCredentials(this.svc.id);
    } catch (err) {
      this.emit('error', new Error(`Failed to load credentials: ${err.message}`));
      return;
    }

    const roomId = Number(this.svc.metadata?.room_id);
    if (!roomId) {
      this.emit('error', Object.assign(
        new Error('No Bilibili room ID configured — set metadata.room_id to your live room number'),
        { code: 'NO_ROOM_ID', permanent: true }
      ));
      return;
    }

    const uid = Number(this.svc.metadata?.uid ?? 0);

    // Fetch danmu connection info (optimal host + auth key) for this room.
    // This endpoint is public for open rooms — no credentials required.
    let danmuOpts = {};
    try {
      danmuOpts = await this._fetchDanmuInfo(roomId);
    } catch (err) {
      logger.warn(`[bilibili-capture:${this.svc.id}] danmu info fetch failed, using defaults: ${err.message}`);
    }

    this._intentionalDisconnect = false;

    try {
      this._ws = new LiveWS(roomId, { uid, ...danmuOpts });
    } catch (err) {
      this.emit('error', err);
      return;
    }

    this._ws.on('open', () => {
      this._connected = true;
      this.emit('connected');
      logger.info(`[bilibili-capture:${this.svc.id}] connected to room ${roomId}`);
    });

    // OP 3: viewer count arrives with each heartbeat ack
    this._ws.on('heartbeat', (viewers) => {
      this.emit('event', this.buildEvent('viewer_count', null, { count: viewers }));
    });

    // LIVE command = stream went live
    this._ws.on('live', () => {
      this.emit('event', this.buildEvent('stream.start', null, {}));
    });

    // All OP 5 CMD messages
    this._ws.on('msg', (data) => this._handleCmd(data));

    this._ws.on('close', () => {
      this._connected = false;
      if (!this._intentionalDisconnect) {
        logger.info(`[bilibili-capture:${this.svc.id}] WebSocket closed — will reconnect`);
        this.emit('disconnected', { reason: 'ws_close' });
      }
    });

    this._ws.on('error', (err) => {
      logger.error(`[bilibili-capture:${this.svc.id}] WebSocket error: ${err.message}`);
      this.emit('error', err);
    });
  }

  async disconnect() {
    this._intentionalDisconnect = true;
    this._connected = false;
    const ws = this._ws;
    this._ws = null;
    if (ws) ws.close();
    this.emit('disconnected', { reason: 'intentional' });
  }

  // ─── Danmu host/key resolution ────────────────────────────────────────────

  async _fetchDanmuInfo(roomId) {
    const res = await fetch(`${DANMU_INFO_API}?room_id=${roomId}&platform=pc&player=web`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.code !== 0) throw new Error(`API error: ${json.message ?? json.code}`);

    const opts = {};
    const token = json.data?.token;
    if (token) opts.key = token;

    const hosts = json.data?.host_list ?? [];
    if (hosts.length > 0) {
      opts.address = `wss://${hosts[0].host}/sub`;
    }

    return opts;
  }

  // ─── CMD dispatch ─────────────────────────────────────────────────────────

  _handleCmd(data) {
    const cmd = data?.cmd;
    if (!cmd) return;

    // Strip suffix variants like "DANMU_MSG:4" → "DANMU_MSG"
    const baseCmd = cmd.split(':')[0];

    switch (baseCmd) {
      case 'DANMU_MSG':        return this._onDanmuMsg(data);
      case 'SUPER_CHAT_MESSAGE': return this._onSuperChat(data);
      case 'SEND_GIFT':        return this._onSendGift(data);
      case 'COMBO_SEND':       return this._onComboSend(data);
      case 'GUARD_BUY':        return this._onGuardBuy(data);
      case 'INTERACT_WORD':    return this._onInteractWord(data);
      case 'PREPARING':
        this.emit('event', this.buildEvent('stream.end', null, {}));
        break;
      default:
        // Silently ignore unknown commands (NOTICE_MSG, ROOM_CHANGE, etc.)
        break;
    }
  }

  _onDanmuMsg(data) {
    // info[0] = message metadata, info[1] = text, info[2] = [uid, uname, is_admin, ...]
    // info[3] = medal [level, name, channel_name, ...] (empty array if no medal)
    const info = data.info ?? [];
    const message = info[1];
    if (!message) return;

    const user = info[2] ?? [];
    const hasMedal = Array.isArray(info[3]) && info[3].length > 0;

    this.emit('event', this.buildEvent(
      'chat.message',
      {
        platformId:  String(user[0] ?? ''),
        username:    user[1] ?? '',
        displayName: user[1] ?? '',
        isSubscriber: hasMedal,
        isModerator:  (user[2] ?? 0) === 1,
      },
      { message: String(message) }
    ));
  }

  _onSuperChat(data) {
    const d = data.data ?? {};
    const user = d.user_info ?? {};
    this.emit('event', this.buildEvent(
      'tip',
      {
        platformId:  String(d.uid ?? ''),
        username:    user.uname ?? '',
        displayName: user.uname ?? '',
        avatarUrl:   user.face  ?? null,
      },
      {
        amount:   d.price ?? 0,
        currency: 'CNY',
        message:  d.message ?? '',
      }
    ));
  }

  _onSendGift(data) {
    const d = data.data ?? {};
    // Only emit for paid (gold) gifts; silver gifts are free and very noisy
    if (d.coin_type !== 'gold') return;

    this.emit('event', this.buildEvent(
      'tip',
      {
        platformId:  String(d.uid ?? ''),
        username:    d.uname ?? '',
        displayName: d.uname ?? '',
        avatarUrl:   d.face  ?? null,
      },
      {
        // Gold coins: 1 gold coin ≈ 0.001 CNY; total_coin is the total coins spent
        amount:    (d.total_coin ?? 0) / 1000,
        currency:  'CNY',
        message:   `Sent ${d.num ?? 1}× ${d.giftName ?? 'gift'}`,
        giftName:  d.giftName ?? '',
        giftCount: d.num ?? 1,
      }
    ));
  }

  _onComboSend(data) {
    // COMBO_SEND fires for rapid consecutive gifts — treat same as SEND_GIFT
    this._onSendGift(data);
  }

  _onGuardBuy(data) {
    // Guard (舰长/提督/总督) — Bilibili's subscription/membership tiers
    const d = data.data ?? {};
    this.emit('event', this.buildEvent(
      'subscribe',
      {
        platformId:  String(d.uid ?? ''),
        username:    d.username ?? '',
        displayName: d.username ?? '',
      },
      {
        tier:           GUARD_TIER[d.guard_level] ?? 'captain',
        durationMonths: d.num ?? 1,
      }
    ));
  }

  _onInteractWord(data) {
    // msg_type: 1=enter room, 2=follow, 3=share, 4=special follow (subscribed follow)
    const d = data.data ?? {};
    if (d.msg_type !== 2 && d.msg_type !== 4) return;

    this.emit('event', this.buildEvent(
      'follow',
      {
        platformId:  String(d.uid ?? ''),
        username:    d.uname ?? '',
        displayName: d.uname ?? '',
      },
      {}
    ));
  }
}

module.exports = BilibiliCapture;
