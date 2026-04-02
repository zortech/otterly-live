import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { OtteryLiveService } from '../ottery-live.service';

export interface Viewer {
  id: number;
  platform: string;
  platform_user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  credits: number;
  last_seen_at: string;
  updated_at: string;
}

export interface CreditTransaction {
  id: number;
  viewer_id: number;
  delta: number;
  reason: 'chat' | 'like' | 'gift' | 'manual' | 'admin_set' | 'spend';
  reference_event_id: string | null;
  note: string | null;
  created_at: string;
}

export interface CreditSettings {
  enabled: boolean;
  nameSingular: string;
  perChatMinute: number;
  perLikeMinute: number;
  giftMultiplier: number;
  transactionRetentionDays: number;
  apiKey: string;
}

export interface ViewerQuery {
  page?: number;
  limit?: number;
  sort?: 'credits' | 'last_seen_at' | 'username';
  order?: 'asc' | 'desc';
  search?: string;
  platform?: string;
}

interface CreditUpdate {
  viewerId: number;
  platform: string;
  platformUserId: string;
  username: string;
  displayName: string;
  credits: number;
}

@Injectable({ providedIn: 'root' })
export class CreditsService {
  private readonly http = inject(HttpClient);
  private readonly otteryService = inject(OtteryLiveService);

  readonly viewers = signal<Viewer[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly settings = signal<CreditSettings | null>(null);

  constructor() {
    this.otteryService.socket.on('ottery:credits', (update: CreditUpdate) => {
      this.viewers.update((list) =>
        list.map((v) =>
          v.id === update.viewerId
            ? { ...v, credits: update.credits, username: update.username, display_name: update.displayName }
            : v
        )
      );
    });
  }

  async loadViewers(query: ViewerQuery = {}): Promise<void> {
    this.loading.set(true);
    try {
      const params: Record<string, string> = {
        page:  String(query.page  ?? 1),
        limit: String(query.limit ?? 50),
        sort:  query.sort  ?? 'credits',
        order: query.order ?? 'desc',
      };
      if (query.search)   params['search']   = query.search;
      if (query.platform) params['platform'] = query.platform;

      const result = await firstValueFrom(
        this.http.get<{ viewers: Viewer[]; total: number }>('/api/credits', { params })
      );
      this.viewers.set(result.viewers);
      this.total.set(result.total);
    } finally {
      this.loading.set(false);
    }
  }

  async loadSettings(): Promise<void> {
    const s = await firstValueFrom(this.http.get<CreditSettings>('/api/credits/settings'));
    this.settings.set(s);
  }

  async saveSettings(partial: Partial<CreditSettings>): Promise<void> {
    await firstValueFrom(this.http.put('/api/credits/settings', partial));
    await this.loadSettings();
  }

  async setCredits(viewerId: number, credits: number, note?: string): Promise<number> {
    const result = await firstValueFrom(
      this.http.put<{ ok: boolean; credits: number }>(`/api/credits/${viewerId}`, { credits, note })
    );
    return result.credits;
  }

  async adjustCredits(viewerId: number, delta: number, note?: string): Promise<number> {
    const result = await firstValueFrom(
      this.http.post<{ ok: boolean; credits: number }>(`/api/credits/${viewerId}/adjust`, { delta, note })
    );
    return result.credits;
  }

  async getHistory(viewerId: number, page = 1, limit = 50): Promise<{ transactions: CreditTransaction[]; total: number }> {
    return firstValueFrom(
      this.http.get<{ transactions: CreditTransaction[]; total: number }>(`/api/credits/${viewerId}/history`, {
        params: { page: String(page), limit: String(limit) },
      })
    );
  }
}
