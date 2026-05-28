import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export type Platform =
  | 'twitch' | 'youtube' | 'kick' | 'tiktok' | 'x' | 'joystick'
  | 'rumble' | 'facebook' | 'bilibili';

export type GiftEventType = 'subscribe' | 'subscribe.gift' | 'cheer' | 'tip' | 'redeem';

export type Position = 'center' | 'top' | 'bottom' | 'left' | 'right';

export interface GiftAnimation {
  id: number;
  label: string;
  platform: Platform;
  eventType: GiftEventType;
  triggerKey: string | null;
  minAmount: number | null;
  animationPath: string;
  durationMs: number;
  soundPath: string | null;
  position: Position;
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export type GiftAnimationInput = Omit<GiftAnimation, 'id' | 'createdAt' | 'updatedAt'>;

export interface TikTokGift {
  id: string;
  name: string;
  diamondCount: number;
  iconUrl: string | null;
}

@Injectable({ providedIn: 'root' })
export class GiftAlertsService {
  private readonly http = inject(HttpClient);
  readonly mappings = signal<GiftAnimation[]>([]);
  readonly tiktokGifts = signal<TikTokGift[]>([]);
  readonly assets = signal<string[]>([]);

  async load(): Promise<void> {
    const list = await firstValueFrom(this.http.get<GiftAnimation[]>('/api/gift-animations'));
    this.mappings.set(list);
  }

  async loadTikTokGifts(): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<{ gifts: TikTokGift[] }>('/api/gift-animations/tiktok-gifts'));
      this.tiktokGifts.set(res.gifts ?? []);
    } catch {
      this.tiktokGifts.set([]);
    }
  }

  async loadAssets(): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<{ files: string[] }>('/api/gift-animations/assets/list'));
      this.assets.set(res.files ?? []);
    } catch {
      this.assets.set([]);
    }
  }

  async create(input: GiftAnimationInput): Promise<GiftAnimation> {
    const created = await firstValueFrom(this.http.post<GiftAnimation>('/api/gift-animations', input));
    this.mappings.update((m) => [...m, created]);
    return created;
  }

  async update(id: number, input: Partial<GiftAnimationInput>): Promise<GiftAnimation> {
    const updated = await firstValueFrom(this.http.put<GiftAnimation>(`/api/gift-animations/${id}`, input));
    this.mappings.update((m) => m.map((x) => x.id === id ? updated : x));
    return updated;
  }

  async remove(id: number): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/gift-animations/${id}`));
    this.mappings.update((m) => m.filter((x) => x.id !== id));
  }

  async test(input: {
    platform: Platform;
    eventType: GiftEventType;
    triggerKey?: string;
    amount?: number;
    username?: string;
    giftName?: string;
    repeatCount?: number;
    message?: string;
  }): Promise<void> {
    await firstValueFrom(this.http.post('/api/gift-animations/test', input));
  }
}
