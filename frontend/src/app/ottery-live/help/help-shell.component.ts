import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

interface NavItem {
  path: string;
  icon: string;
  label: string;
}

@Component({
  selector: 'app-help-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, MatIconModule],
  styles: [`
    :host { display: flex; flex: 1; min-height: 0; overflow: hidden; }

    .help-nav {
      width: 196px; flex-shrink: 0;
      border-right: 1px solid var(--border);
      padding: 4px 8px 16px;
      overflow-y: auto;
    }
    .nav-heading {
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
      color: var(--text-3); padding: 14px 8px 6px;
    }
    .nav-item {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 10px; border-radius: 8px; margin-bottom: 2px;
      font-size: 13px; font-weight: 500; color: var(--text-2);
      text-decoration: none; transition: background 0.1s, color 0.1s;
    }
    .nav-item mat-icon { font-size: 16px; width: 16px; height: 16px; flex-shrink: 0; }
    .nav-item:hover { background: var(--bg-hover); color: var(--text-1); }
    .nav-item.active { background: var(--accent-dim); color: var(--accent); }
    .nav-item.active mat-icon { color: var(--accent); }

    .help-content {
      flex: 1; min-width: 0; overflow-y: auto;
      padding: 0 36px 48px;
      max-width: 780px;
    }
  `],
  template: `
    <nav class="help-nav">
      <div class="nav-heading">Help Guide</div>
      @for (item of navItems; track item.path) {
        <a class="nav-item" [routerLink]="item.path" routerLinkActive="active">
          <mat-icon>{{ item.icon }}</mat-icon>
          {{ item.label }}
        </a>
      }
    </nav>

    <div class="help-content">
      <router-outlet />
    </div>
  `,
})
export class HelpShellComponent {
  readonly navItems: NavItem[] = [
    { path: 'getting-started', icon: 'rocket_launch', label: 'Getting Started' },
    { path: 'dashboard',       icon: 'dashboard',     label: 'Dashboard'       },
    { path: 'platforms',       icon: 'stream',        label: 'Platforms'       },
    { path: 'settings',        icon: 'settings',      label: 'Settings'        },
    { path: 'interfaces',      icon: 'widgets',       label: 'Interfaces'      },
    { path: 'streamtap',       icon: 'hub',           label: 'StreamTap'       },
    { path: 'warudo',          icon: 'sensors',       label: 'Warudo Relay'    },
    { path: 'relay',           icon: 'cell_tower',    label: 'Remote Relay'    },
    { path: 'credits',         icon: 'toll',          label: 'Credits'         },
    { path: 'music',           icon: 'queue_music',   label: 'Music'           },
    { path: 'chat',            icon: 'chat',          label: 'Chat'            },
    { path: 'events',          icon: 'history',       label: 'Event Log'       },
  ];
}
