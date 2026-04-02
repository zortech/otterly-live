import { Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { StreamService, PlatformMeta } from '../stream-services.service';

@Component({
  selector: 'app-platform-card',
  standalone: true,
  imports: [MatIconModule, MatButtonModule],
  styles: [`
    .card {
      background: var(--bg-card); border: 1px solid var(--border);
      border-left: 3px solid var(--brand, var(--text-3));
      border-radius: 10px; padding: 14px 18px;
      display: flex; align-items: center; gap: 16px;
      transition: border-color 0.2s;
    }
    .card:hover { border-color: var(--border-2); }
    .card.inactive { opacity: 0.55; }

    .card-info { flex: 1; min-width: 0; }
    .card-name { font-size: 15px; font-weight: 600; color: var(--text-1); margin-bottom: 3px; }
    .card-sub { font-size: 12px; color: var(--text-2); }

    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;
      background: var(--bg-raised); color: var(--text-2); border: 1px solid var(--border);
    }
    .badge.on   { background: var(--accent-dim); color: var(--accent); border-color: var(--accent-border); }
    .badge.warn { background: rgba(255,71,87,0.1); color: var(--error-color); border-color: rgba(255,71,87,0.2); }
    .badge.ok   { background: rgba(0,230,118,0.08); color: var(--live); border-color: rgba(0,230,118,0.2); }
    .badge.inactive-badge { background: var(--bg-raised); color: var(--text-3); }

    .card-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .action-btn {
      padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;
      cursor: pointer; font-family: inherit; transition: all 0.12s; border: 1px solid var(--border);
      background: var(--bg-raised); color: var(--text-1);
    }
    .action-btn:hover { background: var(--bg-hover); border-color: var(--border-2); }
    .action-btn.delete { color: var(--error-color); border-color: transparent; background: transparent; }
    .action-btn.delete:hover { background: rgba(255,71,87,0.08); border-color: rgba(255,71,87,0.15); }
  `],
  template: `
    <div class="card" [class.inactive]="!service().active"
         [style.--brand]="platformColor(service().platform)">

      <div class="card-info">
        <div class="card-name">{{ service().display_name }}</div>
        <div class="card-sub">
          {{ platformMeta()?.display_name ?? service().platform }}
          @if (service().username) { · @{{ service().username }} }
        </div>

        <div class="badges">
          @if (!service().active) {
            <span class="badge inactive-badge">Inactive</span>
          }
          <span class="badge" [class.on]="service().restream_enabled">
            Restream {{ service().restream_enabled ? 'ON' : 'OFF' }}
          </span>
          @if (platformMeta()?.event_capture_supported !== false) {
            <span class="badge" [class.on]="service().event_capture_enabled">
              Events {{ service().event_capture_enabled ? 'ON' : 'OFF' }}
              @if (platformMeta()?.unofficial_capture) { (unofficial) }
            </span>
          }
          @if (service().stream_key_configured) {
            <span class="badge ok">Key ✓</span>
          } @else {
            <span class="badge">No Key</span>
          }
          @if (service().oauth_connected) {
            <span class="badge ok">OAuth ✓</span>
          }
          @if (service().needs_reauth) {
            <span class="badge warn">Needs Re-auth</span>
          }
        </div>
      </div>

      <div class="card-actions">
        <button class="action-btn" (click)="editRequested.emit(service())">Edit</button>
        <button class="action-btn delete" (click)="deleteRequested.emit(service())">Delete</button>
      </div>
    </div>
  `,
})
export class PlatformCardComponent {
  readonly service = input.required<StreamService>();
  readonly platformMeta = input<PlatformMeta | undefined>();
  readonly editRequested = output<StreamService>();
  readonly deleteRequested = output<StreamService>();

  platformColor(platform: string): string {
    const map: Record<string, string> = {
      twitch: '#9146ff', youtube: '#ff0000', kick: '#53fc18',
      tiktok: '#fe2c55', x: '#c9cdd1', joystick: '#8b5cf6',
    };
    return map[platform] ?? '#7c8aa0';
  }
}
