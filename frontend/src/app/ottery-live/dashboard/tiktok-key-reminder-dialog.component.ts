import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-tiktok-key-reminder-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, DatePipe],
  template: `
    <h2 mat-dialog-title>TikTok Stream Key May Be Expired</h2>
    <mat-dialog-content>
      <p>TikTok generates a new stream key for each session. Your current key may be stale.</p>
      @if (data.lastUpdated) {
        <p style="font-size:0.875rem; color: var(--mat-sys-on-surface-variant);">
          Last updated: {{ data.lastUpdated | date:'medium' }}
        </p>
      } @else {
        <p style="font-size:0.875rem; color: var(--mat-sys-on-surface-variant);">
          Stream key has never been set.
        </p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="'update'">Update Key</button>
      <button mat-raised-button color="primary" [mat-dialog-close]="'continue'">Start Anyway</button>
    </mat-dialog-actions>
  `,
})
export class TikTokKeyReminderDialogComponent {
  readonly data = inject<{ lastUpdated: string | null }>(MAT_DIALOG_DATA);
}
