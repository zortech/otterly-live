import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'chat',
    loadComponent: () =>
      import('./chat/chat-overlay.component').then((m) => m.ChatOverlayComponent),
  },
  {
    path: 'music-queue',
    loadComponent: () =>
      import('./music-queue/music-queue-overlay.component').then((m) => m.MusicQueueOverlayComponent),
  },
  {
    path: 'now-playing',
    loadComponent: () =>
      import('./now-playing/now-playing-overlay.component').then((m) => m.NowPlayingOverlayComponent),
  },
  {
    path: 'goal-single',
    loadComponent: () =>
      import('./goal/goal-single-overlay.component').then((m) => m.GoalSingleOverlayComponent),
  },
  {
    path: 'goal-multi',
    loadComponent: () =>
      import('./goal/goal-multi-overlay.component').then((m) => m.GoalMultiOverlayComponent),
  },
  { path: '', redirectTo: 'chat', pathMatch: 'full' },
];
