import { Component, inject, input, output, signal } from '@angular/core';
import { ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SettingsService } from './settings.service';

@Component({
  selector: 'app-secret-key-field',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatChipsModule,
  ],
  styles: [`
    .key-status { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .key-actions { display: flex; gap: 8px; margin-top: 4px; margin-bottom: 8px; }
    mat-form-field { width: 100%; }
  `],
  template: `
    @if (!showInput()) {
      <div class="key-status">
        @if (configured()) {
          <mat-chip highlighted>{{ label() }} configured ✓</mat-chip>
        } @else {
          <mat-chip>{{ label() }} — Not set</mat-chip>
        }
        <button mat-stroked-button type="button" (click)="showInput.set(true)">
          {{ configured() ? 'Change' : 'Set' }}
        </button>
      </div>
    } @else {
      <mat-form-field>
        <mat-label>New {{ label() }}</mat-label>
        <input matInput type="password" [formControl]="keyControl"
               autocomplete="new-password" />
        <mat-hint>Write-only — stored in OS keychain, never shown again</mat-hint>
      </mat-form-field>
      <div class="key-actions">
        <button mat-button type="button" (click)="cancel()">Cancel</button>
        <button mat-raised-button color="primary" type="button"
                [disabled]="saving() || !keyControl.value"
                (click)="save()">
          {{ saving() ? 'Saving…' : 'Save' }}
        </button>
      </div>
    }
  `,
})
export class SecretKeyFieldComponent {
  readonly label = input.required<string>();
  readonly configured = input.required<boolean>();
  readonly settingsKey = input.required<string>();
  readonly saved = output<void>();

  private readonly svc = inject(SettingsService);
  private readonly snackBar = inject(MatSnackBar);

  readonly showInput = signal(false);
  readonly saving = signal(false);
  readonly keyControl = new FormControl('', Validators.required);

  cancel(): void {
    this.showInput.set(false);
    this.keyControl.reset();
  }

  async save(): Promise<void> {
    if (!this.keyControl.value) return;
    this.saving.set(true);
    try {
      await this.svc.set(this.settingsKey(), this.keyControl.value);
      this.showInput.set(false);
      this.keyControl.reset();
      this.saved.emit();
    } catch {
      this.snackBar.open('Failed to save key', 'Dismiss', { duration: 5000 });
    } finally {
      this.saving.set(false);
    }
  }
}
