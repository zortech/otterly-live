import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'ottery-live/dashboard', pathMatch: 'full' },
  {
    path: 'ottery-live',
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./ottery-live/dashboard/dashboard.component').then(
            (m) => m.DashboardComponent
          ),
      },
      {
        path: 'platforms',
        loadComponent: () =>
          import('./ottery-live/platform-management/platform-management.component').then(
            (m) => m.PlatformManagementComponent
          ),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./ottery-live/settings/settings.component').then(
            (m) => m.SettingsComponent
          ),
      },
      {
        path: 'events',
        loadComponent: () =>
          import('./ottery-live/event-log/event-log.component').then(
            (m) => m.EventLogComponent
          ),
      },
      {
        path: 'interfaces',
        loadComponent: () =>
          import('./ottery-live/interfaces/interfaces.component').then(
            (m) => m.InterfacesComponent
          ),
      },
      {
        path: 'gift-alerts',
        loadComponent: () =>
          import('./ottery-live/gift-alerts/gift-alerts.component').then(
            (m) => m.GiftAlertsComponent
          ),
      },
      {
        path: 'credits',
        loadComponent: () =>
          import('./ottery-live/credits/credits.component').then(
            (m) => m.CreditsComponent
          ),
      },
      {
        path: 'music',
        loadComponent: () =>
          import('./ottery-live/music/music.component').then(
            (m) => m.MusicComponent
          ),
      },
      {
        path: 'chat',
        loadComponent: () =>
          import('./ottery-live/chat/chat.component').then(
            (m) => m.ChatComponent
          ),
      },
      {
        path: 'help',
        loadComponent: () =>
          import('./ottery-live/help/help-shell.component').then(
            (m) => m.HelpShellComponent
          ),
        children: [
          { path: '', redirectTo: 'getting-started', pathMatch: 'full' },
          {
            path: 'getting-started',
            loadComponent: () =>
              import('./ottery-live/help/pages/getting-started.component').then(
                (m) => m.GettingStartedHelpComponent
              ),
          },
          {
            path: 'dashboard',
            loadComponent: () =>
              import('./ottery-live/help/pages/dashboard-help.component').then(
                (m) => m.DashboardHelpComponent
              ),
          },
          {
            path: 'platforms',
            loadComponent: () =>
              import('./ottery-live/help/pages/platforms-help.component').then(
                (m) => m.PlatformsHelpComponent
              ),
          },
          {
            path: 'settings',
            loadComponent: () =>
              import('./ottery-live/help/pages/settings-help.component').then(
                (m) => m.SettingsHelpComponent
              ),
          },
          {
            path: 'interfaces',
            loadComponent: () =>
              import('./ottery-live/help/pages/interfaces-help.component').then(
                (m) => m.InterfacesHelpComponent
              ),
          },
          {
            path: 'streamtap',
            loadComponent: () =>
              import('./ottery-live/help/pages/streamtap-help.component').then(
                (m) => m.StreamTapHelpComponent
              ),
          },
          {
            path: 'warudo',
            loadComponent: () =>
              import('./ottery-live/help/pages/warudo-help.component').then(
                (m) => m.WarudoHelpComponent
              ),
          },
          {
            path: 'credits',
            loadComponent: () =>
              import('./ottery-live/help/pages/credits-help.component').then(
                (m) => m.CreditsHelpComponent
              ),
          },
          {
            path: 'music',
            loadComponent: () =>
              import('./ottery-live/help/pages/music-help.component').then(
                (m) => m.MusicHelpComponent
              ),
          },
          {
            path: 'chat',
            loadComponent: () =>
              import('./ottery-live/help/pages/chat-help.component').then(
                (m) => m.ChatHelpComponent
              ),
          },
          {
            path: 'events',
            loadComponent: () =>
              import('./ottery-live/help/pages/events-help.component').then(
                (m) => m.EventsHelpComponent
              ),
          },
          {
            path: 'relay',
            loadComponent: () =>
              import('./ottery-live/help/pages/relay-help.component').then(
                (m) => m.RelayHelpComponent
              ),
          },
        ],
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },
];
