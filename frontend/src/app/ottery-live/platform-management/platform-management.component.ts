import { Component, inject, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog } from '@angular/material/dialog';
import { StreamService, StreamServicesService } from '../stream-services.service';
import { PlatformCardComponent } from './platform-card.component';
import { PlatformFormDialogComponent, PlatformFormDialogData } from './platform-form-dialog.component';
import { PlatformDeleteDialogComponent, PlatformDeleteDialogData } from './platform-delete-dialog.component';

@Component({
  selector: 'app-platform-management',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    PlatformCardComponent,
  ],
  styles: [`
    .page-header {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;
    }
    .page-title { font-size: 22px; font-weight: 700; color: var(--text-1); letter-spacing: -0.5px; }

    .add-btn {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 18px; border-radius: 8px; font-size: 14px; font-weight: 600;
      background: var(--accent); color: #000; border: none; cursor: pointer;
      font-family: inherit; transition: opacity 0.15s;
    }
    .add-btn:hover:not(:disabled) { opacity: 0.88; }
    .add-btn:disabled { opacity: 0.4; cursor: default; }
    .add-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .loading-bar-wrap { margin-bottom: 16px; border-radius: 4px; overflow: hidden; }

    .empty-state {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
      padding: 48px 32px; text-align: center; max-width: 560px; margin: 0 auto;
    }
    .empty-icon {
      width: 56px; height: 56px; border-radius: 16px;
      background: var(--accent-dim); border: 1px solid var(--accent-border);
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 20px;
    }
    .empty-icon mat-icon { font-size: 28px; width: 28px; height: 28px; color: var(--accent); }
    .empty-title { font-size: 18px; font-weight: 700; color: var(--text-1); margin-bottom: 8px; }
    .empty-desc { color: var(--text-2); font-size: 14px; margin-bottom: 24px; line-height: 1.6; }

    .empty-steps {
      text-align: left; background: var(--bg-raised); border: 1px solid var(--border-2);
      border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;
    }
    .empty-steps-title {
      font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px;
      color: var(--text-3); margin-bottom: 12px;
    }
    .empty-step { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 8px; font-size: 13px; color: var(--text-2); }
    .empty-step:last-child { margin-bottom: 0; }
    .step-dot {
      width: 18px; height: 18px; border-radius: 50%;
      background: var(--accent-dim); border: 1px solid var(--accent-border);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; font-size: 10px; font-weight: 700; color: var(--accent); margin-top: 1px;
    }

    .add-btn-large {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 600;
      background: var(--accent); color: #000; border: none; cursor: pointer;
      font-family: inherit; transition: opacity 0.15s;
    }
    .add-btn-large:hover:not(:disabled) { opacity: 0.88; }
    .add-btn-large:disabled { opacity: 0.4; cursor: default; }
    .add-btn-large mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .platforms-list { display: flex; flex-direction: column; gap: 10px; }
  `],
  template: `
    <div class="page-header">
      <h1 class="page-title">Platforms</h1>
      <button class="add-btn" [disabled]="svc.loading()" (click)="openAdd()">
        <mat-icon>add</mat-icon>
        Add Platform
      </button>
    </div>

    @if (svc.loading()) {
      <div class="loading-bar-wrap">
        <mat-progress-bar mode="indeterminate" />
      </div>
    } @else if (svc.services().length === 0) {
      <div class="empty-state">
        <div class="empty-icon">
          <mat-icon>stream</mat-icon>
        </div>
        <div class="empty-title">No platforms yet</div>
        <div class="empty-desc">
          Add your streaming platforms to start restreaming your OBS broadcast
          to Twitch, YouTube, Kick, and more simultaneously.
        </div>

        <div class="empty-steps">
          <div class="empty-steps-title">Quick start</div>
          <div class="empty-step">
            <div class="step-dot">1</div>
            <span>Click <strong style="color:var(--text-1)">Add Platform</strong> and select a platform</span>
          </div>
          <div class="empty-step">
            <div class="step-dot">2</div>
            <span>Enter your stream key (and optionally connect OAuth for event capture)</span>
          </div>
          <div class="empty-step">
            <div class="step-dot">3</div>
            <span>Go to <strong style="color:var(--text-1)">Settings</strong> to configure your OBS connection</span>
          </div>
          <div class="empty-step">
            <div class="step-dot">4</div>
            <span>Start streaming from OBS — Ottery Live will restream to all configured platforms automatically</span>
          </div>
        </div>

        <button class="add-btn-large" [disabled]="svc.loading()" (click)="openAdd()">
          <mat-icon>add</mat-icon>
          Add Platform
        </button>
      </div>
    } @else {
      <div class="platforms-list">
        @for (service of svc.services(); track service.id) {
          <app-platform-card
            [service]="service"
            [platformMeta]="svc.getPlatformMeta(service.platform)"
            (editRequested)="openEdit($event)"
            (deleteRequested)="openDelete($event)"
          />
        }
      </div>
    }
  `,
})
export class PlatformManagementComponent implements OnInit {
  protected readonly svc = inject(StreamServicesService);
  private readonly dialog = inject(MatDialog);

  async ngOnInit(): Promise<void> {
    await this.svc.loadAll();
  }

  openAdd(): void {
    this.dialog.open<PlatformFormDialogComponent, PlatformFormDialogData>(
      PlatformFormDialogComponent,
      { width: '560px', data: { service: null } }
    );
  }

  openEdit(service: StreamService): void {
    this.dialog.open<PlatformFormDialogComponent, PlatformFormDialogData>(
      PlatformFormDialogComponent,
      { width: '560px', data: { service } }
    );
  }

  openDelete(service: StreamService): void {
    this.dialog.open<PlatformDeleteDialogComponent, PlatformDeleteDialogData>(
      PlatformDeleteDialogComponent,
      { width: '400px', data: { service } }
    );
  }
}
