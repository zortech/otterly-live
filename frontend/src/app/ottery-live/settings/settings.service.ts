import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface PublicSettings {
  'rtmp.port': number;
  'server.port': number;
  'server.bindAddress': string;
  'stream.autoStartOnOBSConnect': boolean;
  'stream.stopCaptureOnStreamEnd': boolean;
  'app.minimizeToTray': boolean;
  'app.checkForUpdates': boolean;
  'app.logLevel': 'error' | 'warn' | 'info' | 'debug';
  'warudo.enabled': boolean;
  'warudo.host': string;
  'warudo.port': number;
  'streamtap.enabled': boolean;
  'streamtap.port': number;
  'streamtap.mdns': boolean;
  'relay.mode': 'local' | 'remote';
  'relay.url': string;
  'relay.allowSelfSigned': boolean;
}

export interface SettingsStatus {
  rtmpKeyConfigured: boolean;
  /** Actual incoming RTMP key — safe to show as it only gates localhost OBS ingestion. */
  rtmpKey?: string;
  streamtapTokenConfigured: boolean;
  relayTokenConfigured: boolean;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/settings';

  readonly settings = signal<PublicSettings | null>(null);
  readonly status = signal<SettingsStatus | null>(null);
  readonly loading = signal(false);

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [s, st] = await Promise.all([
        firstValueFrom(this.http.get<PublicSettings>(this.base)),
        firstValueFrom(this.http.get<SettingsStatus>(`${this.base}/status`)),
      ]);
      this.settings.set(s);
      this.status.set(st);
    } finally {
      this.loading.set(false);
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    await firstValueFrom(this.http.put(this.base, { key, value }));
    // Patch local signal for non-keychain keys
    this.settings.update((s) => (s ? { ...s, [key]: value } : s));
  }

  async refreshStatus(): Promise<void> {
    const st = await firstValueFrom(this.http.get<SettingsStatus>(`${this.base}/status`));
    this.status.set(st);
  }

}
