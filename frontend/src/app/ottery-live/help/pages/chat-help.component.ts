import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { HELP_STYLES } from '../help-styles';

@Component({
  selector: 'app-help-chat',
  standalone: true,
  imports: [MatIconModule],
  styles: [HELP_STYLES],
  template: `
    <h1 class="page-title">Chat</h1>
    <p class="page-tagline">All your platforms' chat in one place — for you, the streamer.</p>

    <h2><mat-icon>chat</mat-icon>What it is</h2>
    <p>The Chat page is a unified, real-time feed of every chat message from all your connected
      platforms. Instead of keeping separate browser tabs open for Twitch chat, YouTube chat,
      and Kick chat, you read everything here in one scrolling panel.</p>
    <p>Each message is labeled with the sender's username and the platform it came from.
      Platform-specific formatting (badges, emotes) is normalised to plain text.</p>

    <div class="callout">
      <mat-icon>info</mat-icon>
      <span>This is a <strong>read-only</strong> monitor for the streamer.
        To send messages back, use each platform's native chat interface or a chatbot.
        The <strong>Chat overlay</strong> (in Interfaces) is a separate browser source for your OBS scene.</span>
    </div>

    <h2><mat-icon>filter_list</mat-icon>Filtering</h2>
    <p>Use the controls at the top of the Chat page to narrow what you see:</p>
    <table class="ref-table">
      <thead><tr><th>Filter</th><th>What it does</th></tr></thead>
      <tbody>
        <tr>
          <td>Platform</td>
          <td>Show messages from one platform only. Useful when you need to focus on a specific
            community during a busy stream.</td>
        </tr>
        <tr>
          <td>Search / keyword</td>
          <td>Highlight messages containing a specific word or phrase — handy for finding a viewer
            asking a specific question in a high-volume chat.</td>
        </tr>
        <tr>
          <td>Event type</td>
          <td>Show only chat messages, or only notification events (follows, subs, etc.),
            or everything mixed.</td>
        </tr>
      </tbody>
    </table>

    <h2><mat-icon>history</mat-icon>Session vs. history</h2>
    <p>The Chat panel shows messages from the current session only — it clears when you
      restart Ottery Live. For a searchable history of all past messages and events,
      use the <strong>Event Log</strong> page.</p>

    <h2><mat-icon>notifications</mat-icon>Notification events in chat</h2>
    <p>Follow alerts, subscription notifications, and donations appear inline with chat messages
      — they're not in a separate panel. This gives you a single chronological stream of
      everything happening in your community, in the order it actually happened.</p>
  `,
})
export class ChatHelpComponent {}
