import { Component, effect, ElementRef, inject, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Lookups } from './core/lookups';
import { Pwa } from './core/pwa';
import { Theme } from './core/theme';
import { Ui } from './core/ui';
import { Icon } from './shared/icon';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  template: `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="logo">₨</span> Expense Tracker</div>
        <button class="btn primary block" (click)="ui.addSheetOpen.set(true)"><app-icon name="add" /> Add record</button>
        <nav aria-label="Main">
          <p class="nav-group">Overview</p>
          @for (l of mainLinks; track l.to) {
            <a [routerLink]="l.to" routerLinkActive="on" [routerLinkActiveOptions]="{ exact: l.to === '/' }"><app-icon [name]="l.icon" />{{ l.label }}</a>
          }
          <p class="nav-group">Manage</p>
          @for (l of manageLinks; track l.to) {
            <a [routerLink]="l.to" routerLinkActive="on"><app-icon [name]="l.icon" />{{ l.label }}</a>
          }
        </nav>
      </aside>

      <header class="topbar">
        <span class="brand"><span class="logo">₨</span> Expense Tracker</span>
        <a class="icon-btn" routerLink="/more" aria-label="More: banks, categories, backup, settings"><app-icon name="more" /></a>
      </header>

      <main class="main">
        @if (!pwa.online()) {
          <div class="banner" role="status">You're offline. Everything still works — your data is stored on this device.</div>
        }
        @if (pwa.updateReady()) {
          <div class="banner info" role="status">
            A new version is available. <button class="btn sm" (click)="pwa.reload()">Reload</button>
          </div>
        }
        <router-outlet />
      </main>

      <nav class="bottom-nav" aria-label="Main">
        <a routerLink="/" routerLinkActive="on" [routerLinkActiveOptions]="{ exact: true }"><app-icon name="home" /><span>Home</span></a>
        <a routerLink="/transactions" routerLinkActive="on"><app-icon name="list" /><span>Transactions</span></a>
        <button class="add" (click)="ui.addSheetOpen.set(true)" aria-label="Add record"><app-icon name="add" /></button>
        <a routerLink="/loans" routerLinkActive="on"><app-icon name="people" /><span>People</span></a>
        <a routerLink="/reports" routerLinkActive="on"><app-icon name="chart" /><span>Reports</span></a>
      </nav>
    </div>

    <dialog #sheet class="sheet" (close)="ui.addSheetOpen.set(false)" (click)="backdropClose($event)" aria-labelledby="add-title">
      <div class="sheet-body">
        <div class="sheet-head">
          <h2 id="add-title">Add</h2>
          <button class="icon-btn" (click)="ui.addSheetOpen.set(false)" aria-label="Close"><app-icon name="close" /></button>
        </div>
        <div class="quick-grid">
          @for (q of quick; track q.type) {
            <a [routerLink]="['/new', q.type]" (click)="ui.addSheetOpen.set(false)" [class]="'quick ' + q.type">
              <app-icon [name]="q.icon" /><span>{{ q.label }}</span>
            </a>
          }
        </div>
        <a class="more-link" routerLink="/more" (click)="ui.addSheetOpen.set(false)">Banks, categories, backup & settings →</a>
      </div>
    </dialog>

    <dialog #confirm class="confirm" (close)="answer(false)" aria-labelledby="confirm-msg">
      <p id="confirm-msg">{{ ui.confirmReq()?.message }}</p>
      <div class="row end">
        <button class="btn ghost" (click)="answer(false)">Cancel</button>
        <button class="btn danger" (click)="answer(true)">{{ ui.confirmReq()?.ok }}</button>
      </div>
    </dialog>

    <div class="toast-stack" aria-live="polite">
      @for (t of ui.toasts(); track t.id) {
        <div class="toast" [class.error]="t.error" [attr.role]="t.error ? 'alert' : 'status'">{{ t.text }}</div>
      }
    </div>
  `,
})
export class App {
  protected readonly ui = inject(Ui);
  protected readonly pwa = inject(Pwa);
  private readonly sheet = viewChild.required<ElementRef<HTMLDialogElement>>('sheet');
  private readonly confirmDlg = viewChild.required<ElementRef<HTMLDialogElement>>('confirm');

  protected readonly mainLinks = [
    { to: '/', label: 'Home', icon: 'home' },
    { to: '/transactions', label: 'All transactions', icon: 'list' },
    { to: '/expenses', label: 'Expenses', icon: 'expense' },
    { to: '/income', label: 'Income', icon: 'income' },
    { to: '/transfers', label: 'Transfers', icon: 'swap' },
    { to: '/loans', label: 'People & Loans', icon: 'people' },
    { to: '/reports', label: 'Reports', icon: 'chart' },
  ] as const;
  protected readonly manageLinks = [
    { to: '/accounts', label: 'Banks & accounts', icon: 'bank' },
    { to: '/categories', label: 'Categories', icon: 'tag' },
    { to: '/backup', label: 'Backup & restore', icon: 'backup' },
    { to: '/settings', label: 'Settings', icon: 'settings' },
  ] as const;
  protected readonly quick = [
    { type: 'expense', label: 'Add expense', icon: 'expense' },
    { type: 'income', label: 'Add income', icon: 'income' },
    { type: 'lend', label: 'Lend money', icon: 'people' },
    { type: 'borrow', label: 'Borrow money', icon: 'people' },
    { type: 'repayment', label: 'Record repayment', icon: 'swap' },
    { type: 'transfer', label: 'Transfer between accounts', icon: 'bank' },
  ] as const;

  constructor() {
    inject(Lookups); // start syncing currency/accounts early
    inject(Theme); // apply the saved light/dark preference
    effect(() => {
      const d = this.sheet().nativeElement;
      if (this.ui.addSheetOpen() && !d.open) d.showModal();
      else if (!this.ui.addSheetOpen() && d.open) d.close();
    });
    effect(() => {
      const d = this.confirmDlg().nativeElement;
      if (this.ui.confirmReq() && !d.open) d.showModal();
    });
  }

  protected backdropClose(e: MouseEvent) {
    if (e.target === this.sheet().nativeElement) this.ui.addSheetOpen.set(false);
  }

  protected answer(ok: boolean) {
    const req = this.ui.confirmReq();
    if (!req) return;
    this.ui.confirmReq.set(null);
    this.confirmDlg().nativeElement.close();
    req.resolve(ok);
  }
}
