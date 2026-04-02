import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { OtteryLiveService } from './ottery-live.service';

export interface StreamService {
  id: number;
  platform: string;
  display_name: string;
  rtmp_url: string;
  username: string | null;
  restream_enabled: boolean;
  event_capture_enabled: boolean;
  auto_start: boolean;
  active: boolean;
  api_token_expires_at: string | null;
  needs_reauth: boolean;
  metadata: Record<string, unknown> | null;
  stream_key_configured: boolean;
  oauth_connected: boolean;
  api_client_configured: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlatformMeta {
  id: string;
  display_name: string;
  rtmp_url: string;
  event_capture_supported: boolean;
  oauth_flow?: string;
  rtmp_url_hint?: string;
  stream_key_session_specific?: boolean;
  stream_key_auto_fetch?: boolean;
  unofficial_capture?: boolean;
  requires_premium?: boolean;
  rtmp_access_gated?: boolean;
}

export interface CreateServicePayload {
  platform: string;
  display_name: string;
  rtmp_url: string;
  username?: string;
  restream_enabled?: boolean;
  event_capture_enabled?: boolean;
  auto_start?: boolean;
  stream_key?: string;
  api_client_id?: string;
  api_client_secret?: string;
}

export interface UpdateServicePayload extends Partial<CreateServicePayload> {
  active?: boolean;
  metadata?: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class StreamServicesService {
  private readonly http = inject(HttpClient);
  private readonly live = inject(OtteryLiveService);
  private readonly base = '/api/stream-services';

  readonly services = signal<StreamService[]>([]);
  readonly platforms = signal<PlatformMeta[]>([]);
  readonly loading = signal(false);

  constructor() {
    this.live.socket.on('stream-services:updated', (msg: {
      action: 'created' | 'updated' | 'deleted';
      service?: StreamService;
      serviceId?: number;
    }) => {
      if (msg.action === 'created' && msg.service) {
        this.services.update((s) => [...s, msg.service!]);
      } else if (msg.action === 'updated' && msg.service) {
        this.services.update((s) =>
          s.map((x) => (x.id === msg.service!.id ? msg.service! : x))
        );
      } else if (msg.action === 'deleted' && msg.serviceId) {
        this.services.update((s) => s.filter((x) => x.id !== msg.serviceId));
      }
    });
  }

  async loadAll(): Promise<void> {
    this.loading.set(true);
    try {
      const [services, platforms] = await Promise.all([
        firstValueFrom(this.http.get<StreamService[]>(this.base)),
        firstValueFrom(this.http.get<PlatformMeta[]>(`${this.base}/platforms`)),
      ]);
      this.services.set(services);
      this.platforms.set(platforms);
    } finally {
      this.loading.set(false);
    }
  }

  async create(payload: CreateServicePayload): Promise<StreamService> {
    return firstValueFrom(this.http.post<StreamService>(this.base, payload));
  }

  async update(id: number, payload: UpdateServicePayload): Promise<StreamService> {
    return firstValueFrom(this.http.put<StreamService>(`${this.base}/${id}`, payload));
  }

  async delete(id: number): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.base}/${id}`));
  }

  getById(id: number): StreamService | undefined {
    return this.services().find((s) => s.id === id);
  }

  getPlatformMeta(platformId: string): PlatformMeta | undefined {
    return this.platforms().find((p) => p.id === platformId);
  }
}
