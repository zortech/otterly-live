import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly updateReady = signal(false);

  constructor(private readonly router: Router) {
    window.otteryElectron?.onUpdateReady(() => this.updateReady.set(true));
    window.otteryElectron?.onNavigate((route: string) => this.router.navigateByUrl(route));
  }

  restartForUpdate() {
    window.otteryElectron?.restartForUpdate();
  }
}
