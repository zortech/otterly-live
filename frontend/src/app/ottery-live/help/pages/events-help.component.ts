import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { HELP_STYLES } from '../help-styles';

@Component({
  selector: 'app-help-events',
  standalone: true,
  imports: [MatIconModule],
  styles: [HELP_STYLES],
  template: `
    <h1 class="page-title">Event Log</h1>
    <p class="page-tagline">A searchable history of every event from every stream you've run.</p>

    <h2><mat-icon>storage</mat-icon>What's logged</h2>
    <p>Every event Ottery Live captures is stored permanently in the local database — follows,
      subscriptions, gift subs, cheers, tips, donations, redeems, and chat messages.
      Events accumulate across sessions, so you can look back at any previous stream.</p>
    <table class="ref-table">
      <thead><tr><th>Event type</th><th>What's stored</th></tr></thead>
      <tbody>
        <tr><td>Follow</td><td>Platform, username, timestamp</td></tr>
        <tr><td>Subscribe</td><td>Platform, username, tier, whether it's a resub, streak/tenure months</td></tr>
        <tr><td>Gift sub</td><td>Platform, gifter username, number of gifts, recipient names</td></tr>
        <tr><td>Cheer / Bits</td><td>Platform, username, amount, message</td></tr>
        <tr><td>Tip / Donation</td><td>Platform, username, amount, currency, message</td></tr>
        <tr><td>Redeem</td><td>Platform, username, redeem name, input message</td></tr>
        <tr><td>Chat message</td><td>Platform, username, message text</td></tr>
      </tbody>
    </table>

    <h2><mat-icon>search</mat-icon>Searching and filtering</h2>
    <p>Use the controls at the top to narrow the log:</p>
    <table class="ref-table">
      <thead><tr><th>Filter</th><th>What it does</th></tr></thead>
      <tbody>
        <tr>
          <td>Platform</td>
          <td>Show events from one specific platform — e.g. only Twitch events.</td>
        </tr>
        <tr>
          <td>Event type</td>
          <td>Show only one type of event — follows only, tips only, etc.</td>
        </tr>
        <tr>
          <td>Date range</td>
          <td>Filter by a specific stream session or time window. Each stream session is
            grouped by start time so you can look at one stream in isolation.</td>
        </tr>
        <tr>
          <td>Username</td>
          <td>Find all events from a specific viewer — useful for checking a loyal viewer's
            history or resolving a dispute about a redeem.</td>
        </tr>
      </tbody>
    </table>

    <h2><mat-icon>folder_open</mat-icon>Database access</h2>
    <p>All event data is stored in a SQLite file at:</p>
    <p><code>&#123;userData&#125;/ottery-live.db</code></p>
    <p>On Windows, <code>&#123;userData&#125;</code> is typically
      <code>C:\Users\[you]\AppData\Roaming\ottery-live</code>.
      On macOS it's <code>~/Library/Application Support/ottery-live</code>.
      On Linux it's <code>~/.config/ottery-live</code>.</p>
    <p>You can open this file directly with any SQLite viewer (like
      <strong>DB Browser for SQLite</strong>) to export, query, or back up your data.</p>

    <div class="callout warn">
      <mat-icon>warning</mat-icon>
      <span>Chat messages can accumulate quickly during long streams. If the database grows
        large, you can delete old chat message rows directly in a SQLite viewer without
        affecting event or settings data. Backs up the file first.</span>
    </div>

    <h2><mat-icon>insights</mat-icon>Tips for using the Event Log</h2>
    <ul>
      <li>Filter by <strong>tip / donation</strong> to total up earnings after a stream</li>
      <li>Filter by <strong>username</strong> to see a viewer's full engagement history</li>
      <li>Filter by <strong>follow</strong> on a specific date to review growth from a raid</li>
      <li>Export via DB Browser to a CSV for spreadsheet analysis</li>
    </ul>
  `,
})
export class EventsHelpComponent {}
