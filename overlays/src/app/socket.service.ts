import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';

export type Platform = 'twitch' | 'youtube' | 'kick' | 'tiktok' | 'x' | 'joystick' | 'otterly';

export type EventType =
  | 'chat.message' | 'follow' | 'subscribe' | 'subscribe.gift'
  | 'cheer' | 'tip' | 'like' | 'share' | 'raid' | 'redeem'
  | 'stream.start' | 'stream.end' | 'viewer_count'
  | 'system.capture_connected' | 'system.capture_disconnected' | 'system.capture_error'
  | 'otterly.redeem' | 'otterly.credit_count' | 'otterly.playing';

export interface EventActor {
  platformId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  isSubscriber?: boolean;
  isModerator?: boolean;
}

export interface OtteryEvent {
  id: string;
  sessionId: number | null;
  platform: Platform;
  type: EventType;
  timestamp: string;
  actor: EventActor | null;
  data: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class SocketService {
  readonly connected = signal(false);
  readonly socket: Socket;

  // In dev mode (port 4201), connect to server on 3737 directly.
  // In production, the overlay is served from the same server, so use current origin.
  private readonly serverUrl =
    window.location.port === '4201'
      ? 'http://localhost:3737'
      : window.location.origin;

  constructor() {
    this.socket = io(this.serverUrl, { transports: ['websocket'] });
    this.socket.on('connect', () => this.connected.set(true));
    this.socket.on('disconnect', () => this.connected.set(false));
  }
}
