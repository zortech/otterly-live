import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { StreamService } from '../stream-services.service';
import { StreamServicesService } from '../stream-services.service';

export interface PlatformDeleteDialogData {
  service: StreamService;
}

@Component({
  selector: 'app-platform-delete-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Delete {{ data.service.display_name }}?</h2>
    <mat-dialog-content>
      <p>This will permanently remove the platform configuration.
      The stream key and any saved credentials will be deleted from the OS keychain.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button color="warn"
              [disabled]="deleting()"
              (click)="confirm()">
        {{ deleting() ? 'Deleting…' : 'Delete' }}
      </button>
    </mat-dialog-actions>
  `,
})
export class PlatformDeleteDialogComponent {
  readonly data = inject<PlatformDeleteDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<PlatformDeleteDialogComponent>);
  private readonly svc = inject(StreamServicesService);
  private readonly snackBar = inject(MatSnackBar);

  readonly deleting = signal(false);

  async confirm(): Promise<void> {
    this.deleting.set(true);
    try {
      await this.svc.delete(this.data.service.id);
      this.dialogRef.close('deleted');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete platform';
      this.snackBar.open(msg, 'Dismiss', { duration: 5000 });
      this.deleting.set(false);
    }
  }
}
