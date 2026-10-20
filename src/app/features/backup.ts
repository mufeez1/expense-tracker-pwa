import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { formatBytes } from '../core/attachments';
import { applyBackup, exportBackup, ImportMode, ParsedBackup, readBackup } from '../core/backup';
import { today } from '../core/dates';
import { Pwa } from '../core/pwa';
import { Repo } from '../core/repo';
import { load, shareOrDownload, Ui } from '../core/ui';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-backup',
  imports: [FormsModule, DatePipe, Icon],
  template: `
    <header class="page-head"><h1>Backup & restore</h1></header>

    <section class="card">
      <h2>Export a backup</h2>
      <p>Your records live only in this browser on this device. Clearing browser data, uninstalling the app or losing the device deletes them.
        Export a backup regularly and keep it somewhere safe. The ZIP contains every record and all receipts, <b>unencrypted</b>.</p>
      <p class="muted small">Last backup: {{ lastBackup() ? (lastBackup() | date: 'medium') : 'never' }}</p>
      @if (exportFile(); as f) {
        <div class="row wrap">
          <button class="btn primary" (click)="saveExport(false)"><app-icon name="download" /> Download {{ f.name }} ({{ size(f.blob.size) }})</button>
          @if (mobile) { <button class="btn ghost" (click)="saveExport(true)"><app-icon name="share" /> Share / Save to Files</button> }
        </div>
      } @else {
        <button class="btn primary" (click)="export()" [disabled]="busy()">{{ busy() ? 'Preparing…' : 'Create backup' }}</button>
      }
    </section>

    <section class="card">
      <h2>Restore from a backup</h2>
      <label class="btn ghost">
        Choose backup file (.zip)
        <input type="file" accept=".zip,application/zip" (change)="pick($event)" hidden />
      </label>

      @if (parsed(); as p) {
        <div class="preview">
          <p>Backup from <b>{{ p.exportedAt | date: 'medium' }}</b> contains:</p>
          <ul>
            <li>{{ p.counts.transactions }} records</li>
            <li>{{ p.counts.attachments }} attachments</li>
            <li>{{ p.counts.accounts }} accounts, {{ p.counts.categories }} categories</li>
          </ul>
          @if (p.duplicates) {
            <p class="hint">{{ p.duplicates }} record(s) already exist on this device; {{ p.conflicts }} of them differ from your copy.</p>
          }
          <fieldset class="field">
            <legend>How to restore</legend>
            <label class="check"><input type="radio" name="mode" value="merge" [(ngModel)]="mode" /> Merge — keep my data, add new records; for duplicates the most recently updated copy wins</label>
            <label class="check"><input type="radio" name="mode" value="replace" [(ngModel)]="mode" /> Replace — delete everything on this device first</label>
          </fieldset>
          @if (progress() !== null) {
            <progress [value]="progress()" max="100" aria-label="Import progress"></progress>
          } @else {
            <div class="row">
              <button class="btn primary" (click)="restore(p)">Restore</button>
              <button class="btn ghost" (click)="parsed.set(null)">Cancel</button>
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class Backup {
  private readonly repo = inject(Repo);
  private readonly ui = inject(Ui);
  protected readonly mobile = inject(Pwa).isIos || inject(Pwa).isAndroid;
  protected readonly size = formatBytes;
  protected readonly busy = signal(false);
  protected readonly exportFile = signal<{ blob: Blob; name: string } | null>(null);
  protected readonly parsed = signal<ParsedBackup | null>(null);
  protected readonly mode = signal<ImportMode>('merge');
  protected readonly progress = signal<number | null>(null);
  protected readonly lastBackup = load(() => this.repo.rev(), () => this.repo.setting<number | null>('lastBackupAt', null), null);

  protected async export() {
    this.busy.set(true);
    try {
      const blob = await exportBackup(this.repo.db);
      this.exportFile.set({ blob, name: `expense-tracker-backup-${today()}.zip` });
      await this.repo.setSetting('lastBackupAt', Date.now());
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected saveExport(share: boolean) {
    const f = this.exportFile();
    if (f) shareOrDownload(f.blob, f.name, share);
  }

  protected async pick(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      this.parsed.set(await readBackup(file, this.repo.db));
    } catch (err) {
      this.parsed.set(null);
      this.ui.error(err);
    }
  }

  protected async restore(p: ParsedBackup) {
    const msg =
      this.mode() === 'replace'
        ? 'Replace ALL data on this device with this backup? Records not in the backup will be permanently deleted.'
        : `Merge ${p.counts.transactions} records into your data?`;
    if (!(await this.ui.confirm(msg, this.mode() === 'replace' ? 'Replace everything' : 'Merge'))) return;
    this.progress.set(0);
    try {
      const r = await applyBackup(this.repo.db, p, this.mode(), (n) => this.progress.set(n));
      this.repo.changed();
      this.ui.toast(`Restore complete: ${r.added} added, ${r.updated} updated, ${r.skipped} unchanged.`);
      this.parsed.set(null);
    } catch (e) {
      this.ui.error(e);
      this.ui.toast('Nothing was changed — the import was rolled back.', true);
    } finally {
      this.progress.set(null);
    }
  }
}
