import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { formatBytes } from '../core/attachments';
import { Lookups } from '../core/lookups';
import { Pwa } from '../core/pwa';
import { Repo } from '../core/repo';
import { ACCENTS, BACKGROUNDS, Theme, ThemeMode } from '../core/theme';
import { load, Ui } from '../core/ui';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, RouterLink],
  template: `
    <header class="page-head"><h1>Settings</h1></header>

    <section class="card">
      <h2 id="s-theme">Appearance</h2>
      <div class="tabs" role="radiogroup" aria-labelledby="s-theme">
        @for (t of themes; track t.id) {
          <button type="button" role="radio" [class.on]="theme.mode() === t.id" [attr.aria-checked]="theme.mode() === t.id" (click)="theme.setMode(t.id)">{{ t.name }}</button>
        }
      </div>
      <h3 id="s-accent">Colour <span class="muted">(buttons & highlights)</span></h3>
      <div class="swatches" role="radiogroup" aria-labelledby="s-accent">
        @for (a of accents; track a.id) {
          <button type="button" role="radio" [attr.aria-checked]="theme.accent() === a.id" (click)="theme.setAccent(a.id)">
            <i [style.background]="a.swatch" aria-hidden="true">
              @if (theme.accent() === a.id) { <svg viewBox="0 0 24 24"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg> }
            </i>
            {{ a.name }}
          </button>
        }
      </div>
      <h3 id="s-bg">Background</h3>
      <div class="swatches bg" role="radiogroup" aria-labelledby="s-bg">
        @for (b of backgrounds; track b.id) {
          <button type="button" role="radio" [attr.aria-checked]="theme.background() === b.id" (click)="theme.setBackground(b.id)">
            <i [style.background]="theme.dark() ? b.dark : b.light" aria-hidden="true">
              @if (theme.background() === b.id) { <svg viewBox="0 0 24 24"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg> }
            </i>
            {{ b.name }}
          </button>
        }
      </div>
      <p class="muted small">System follows your device's light or dark setting. These choices are saved on this device only.</p>
    </section>

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
  protected readonly theme = inject(Theme);
  protected readonly accents = ACCENTS;
  protected readonly backgrounds = BACKGROUNDS;
  protected readonly themes: { id: ThemeMode; name: string }[] = [
    { id: 'system', name: 'System' },
    { id: 'light', name: 'Light' },
    { id: 'dark', name: 'Dark' },
  ];
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
