import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { HELP_STYLES } from '../help-styles';

@Component({
  selector: 'app-help-credits',
  standalone: true,
  imports: [MatIconModule],
  styles: [HELP_STYLES],
  template: `
    <h1 class="page-title">Credits</h1>
    <p class="page-tagline">A cross-platform loyalty currency your viewers earn by engaging with your stream.</p>

    <h2><mat-icon>toll</mat-icon>What are credits?</h2>
    <p>Credits are a virtual currency you award to viewers for engaging with your stream.
      They earn credits automatically through follows, subscriptions, donations, and chatting.
      Once they've earned enough, they can spend them on custom <em>redeems</em> you define.</p>
    <p>Credits are tracked per-viewer across <em>all</em> your platforms simultaneously. A viewer
      who follows on Twitch and donates on YouTube shares one unified credit balance — you don't
      need to manage separate systems per platform.</p>

    <h2><mat-icon>settings</mat-icon>Earn rules</h2>
    <p>You control exactly how many credits each action awards. Configure these on the Credits page:</p>
    <table class="ref-table">
      <thead><tr><th>Action</th><th>Notes</th></tr></thead>
      <tbody>
        <tr><td>Follow</td><td>Awarded once per account — following multiple platforms doesn't multiply it.</td></tr>
        <tr><td>Subscribe / Join</td><td>Awarded on new subscription. Re-subs also count.</td></tr>
        <tr><td>Gift sub</td><td>Awarded to the person who gifted (not the recipients). Configurable per gift.</td></tr>
        <tr><td>Cheer / Bits</td><td>Awarded per 100 bits (or whatever increment you set).</td></tr>
        <tr><td>Tip / Donation</td><td>Awarded per currency unit (e.g. per dollar). Works for SuperChats, TikTok coins, Rumble rants, etc.</td></tr>
        <tr><td>Chat message</td><td>Optional passive earn — a small amount per message sent. Good for encouraging chat engagement. Leave at 0 to disable.</td></tr>
      </tbody>
    </table>

    <h2><mat-icon>redeem</mat-icon>Creating redeems</h2>
    <p>Redeems are things viewers can spend their credits on. You define the name, cost, and
      what happens when triggered:</p>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-body">
          <strong>Give it a name</strong>
          <p>This is the command viewers type — e.g. <code>fireworks</code>. They redeem it by
            typing <code>!redeem fireworks</code> in any connected chat.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-body">
          <strong>Set a cost</strong>
          <p>How many credits it costs to redeem. The viewer's balance must be at or above this
            to redeem successfully.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-body">
          <strong>Connect it to Warudo or StreamTap</strong>
          <p>When a viewer redeems, an <code>otterly.redeem</code> event fires with the redeem
            name and the viewer's username. Use this in a Warudo blueprint to trigger an
            animation, or in a StreamTap tool to do anything you like.</p>
        </div>
      </div>
    </div>

    <h2><mat-icon>chat</mat-icon>Viewer commands</h2>
    <table class="ref-table">
      <thead><tr><th>Command</th><th>What it does</th></tr></thead>
      <tbody>
        <tr>
          <td><code>!credits</code></td>
          <td>The viewer checks their own balance. Ottery Live replies in chat on the same platform.</td>
        </tr>
        <tr>
          <td><code>!redeem [name]</code></td>
          <td>Spend credits on a redeem. If the viewer has enough credits and the redeem exists, the balance is deducted and the event fires.</td>
        </tr>
      </tbody>
    </table>

    <h2><mat-icon>manage_accounts</mat-icon>Viewer lookup</h2>
    <p>On the Credits page you can search for any viewer by username and see their balance,
      their earning history, and manually adjust credits if needed (e.g. to correct an error
      or run a giveaway).</p>

    <div class="callout">
      <mat-icon>info</mat-icon>
      <span>Credits are stored in the local SQLite database. They persist across streams and
        sessions and are never synced to any cloud service.</span>
    </div>
  `,
})
export class CreditsHelpComponent {}
