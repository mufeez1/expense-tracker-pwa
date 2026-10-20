import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { formatBytes } from '../core/attachments';
import { Lookups } from '../core/lookups';
import { Pwa } from '../core/pwa';
import { Repo } from '../core/repo';
import { load, Ui } from '../core/ui';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, RouterLink],
  template: `
    <header class="page-head"><h1>Settings</h1></header>

    <section class="card form">
      <h2>Currency</h2>
      <div class="form-grid">
        <div class="field"><label for="s-sym">Symbol</label><input id="s-sym" [(ngModel)]="symbol" maxlength="8" /></div>
        <div class="field"><label for="s-code">Code</label><input id="s-code" [(ngModel)]="code" maxlength="8" /></div>
      </div>
      <p class="muted small">Changes only the label; stored amounts are not converted.</p>
      <button class="btn primary sm" (click)="saveCurrency()" [disabled]="!symbol().trim() || !code().trim()">Save currency</button>
    </section>

    <section class="card" id="storage">
      <h2>Storage on this device</h2>
      @if (stats(); as s) {
        <dl class="kv">
          <dt>Records</dt><dd>{{ s.counts.transactions }}</dd>
          <dt>Attachments</dt><dd>{{ s.counts.attachments }} ({{ size(s.counts.attachmentBytes) }})</dd>
          <dt>Accounts / categories</dt><dd>{{ s.counts.accounts }} / {{ s.counts.categories }}</dd>
          @if (s.info.usage !== undefined) {
            <dt>Used by this app</dt><dd>{{ size(s.info.usage!) }} of ~{{ size(s.info.quota ?? 0) }} available to the browser</dd>
          } @else {
            <dt>Usage</dt><dd>This browser does not report storage usage.</dd>
          }
          <dt>Persistent storage</dt><dd>{{ s.info.persisted ? 'Granted — the browser will not clear data automatically' : 'Not granted' }}</dd>
        </dl>
        @if (!s.info.persisted) { <button class="btn ghost sm" (click)="persist()">Request persistent storage</button> }
      }
      <div class="notice">
        <p><b>Your data never leaves this device.</b> Records and receipts are stored in this browser's IndexedDB, for this browser profile only.
          They are <b>not encrypted</b> by the app and are not synced anywhere.</p>
        <p>Clearing site data, uninstalling the app, using private browsing, or losing the device will delete them.
          On iPhone, Safari may also clear data for sites you haven't opened in a while unless the app is added to the Home Screen.
          <a routerLink="/backup">Export backups</a> regularly — exported files are ordinary files that anyone with access can read.</p>
      </div>
    </section>

    <section class="card" id="install">
      <h2>Install the app</h2>
      @if (pwa.standalone) {
        <p>You're using the installed app. ✓</p>
      } @else {
        @if (pwa.canPrompt()) { <button class="btn primary" (click)="pwa.install()">Install app</button> }
        <h3>iPhone & iPad (Safari)</h3>
        <ol>
          <li>Open this site in <b>Safari</b>.</li>
          <li>Tap the <b>Share</b> button (square with an arrow).</li>
          <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
          <li>Open the app from your Home Screen. iOS can't install it automatically.</li>
        </ol>
        <h3>Android (Chrome)</h3>
        <ol>
          <li>Use the <b>Install app</b> button above if it appears, or</li>
          <li>Tap the <b>⋮</b> menu and choose <b>Install app</b> / <b>Add to Home screen</b>.</li>
        </ol>
        <h3>Desktop (Chrome / Edge)</h3>
        <p>Click the install icon in the address bar.</p>
      }
    </section>
  `,
})
export class Settings {
  protected readonly pwa = inject(Pwa);
  private readonly repo = inject(Repo);
  private readonly ui = inject(Ui);
  private readonly lookups = inject(Lookups);
  protected readonly size = formatBytes;
  protected readonly symbol = signal('');
  protected readonly code = signal('');
  private readonly bump = signal(0);

  protected readonly stats = load(
    () => ({ rev: this.repo.rev(), b: this.bump() }),
    async () => ({ counts: await this.repo.counts(), info: await this.pwa.storageInfo() }),
    null,
  );

  constructor() {
    effect(() => {
      const c = this.lookups.currency();
      this.symbol.set(c.symbol);
      this.code.set(c.code);
    });
  }

  protected async saveCurrency() {
    try {
      await this.repo.setSetting('currency', { symbol: this.symbol().trim(), code: this.code().trim().toUpperCase() });
      this.ui.toast('Currency saved.');
    } catch (e) {
      this.ui.error(e);
    }
  }

  protected async persist() {
    const ok = await this.pwa.persist();
    this.ui.toast(ok ? 'Persistent storage granted.' : 'The browser declined. Installing the app usually helps.', !ok);
    this.bump.update((n) => n + 1);
  }
}
