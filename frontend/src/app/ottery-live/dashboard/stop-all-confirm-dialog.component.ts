import { Component } from '@angular/core';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-stop-all-confirm-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Stop All Platforms?</h2>
    <mat-dialog-content>
      <p>Restreaming will stop for all platforms. Event capture will continue running.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-button color="warn" [mat-dialog-close]="true">Stop All</button>
    </mat-dialog-actions>
  `,
})
export class StopAllConfirmDialogComponent {}
