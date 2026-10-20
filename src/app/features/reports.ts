import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { monthRange, previousPeriod, thisMonth, today } from '../core/dates';
import { Lookups } from '../core/lookups';
import { Pwa } from '../core/pwa';
import { buildReport, renderPdf, ReportKind, toCsv } from '../core/report';
import { Repo } from '../core/repo';
import { load, MoneyPipe, shareOrDownload, Ui } from '../core/ui';
import { FilterSheet } from '../shared/filter-sheet';
import { Icon } from '../shared/icon';
import { Select, SelectOption, toOptions } from '../shared/select';

@Component({
  selector: 'app-reports',
  imports: [FormsModule, MoneyPipe, Icon, FilterSheet, Select],
  template: `
    <header class="page-head"><h1>Reports</h1></header>

    <section class="card form">
      <div class="tabs" role="tablist">
        <button role="tab" [class.on]="mode() === 'month'" [attr.aria-selected]="mode() === 'month'" (click)="mode.set('month')">Month</button>
        <button role="tab" [class.on]="mode() === 'range'" [attr.aria-selected]="mode() === 'range'" (click)="mode.set('range')">Custom range</button>
      </div>
      <div class="form-grid">
        @if (mode() === 'month') {
          <div class="field"><label for="r-month">Month</label><input id="r-month" type="month" [ngModel]="month()" (ngModelChange)="$event && month.set($event)" /></div>
        } @else {
          <div class="field"><label for="r-from">From</label><input id="r-from" type="date" [(ngModel)]="from" /></div>
          <div class="field"><label for="r-to">To</label><input id="r-to" type="date" [(ngModel)]="to" /></div>
        }
      </div>
      <div class="toolbar">
        <p class="muted small grow">{{ summary() }}</p>
        <app-filter-sheet title="Report filters" [active]="activeFilters()" (clear)="reset()">
          <div class="form-grid">
            <div class="field">
              <label for="r-kind">Report type</label>
              <app-select inputId="r-kind" [options]="kindOpts" [(ngModel)]="kind" />
            </div>
            <div class="field">
              <label for="r-acc">Bank / account</label>
              <app-select inputId="r-acc" [options]="accountOpts()" [(ngModel)]="accountId" />
            </div>
            <div class="field">
              <label for="r-cat">Category</label>
              <app-select inputId="r-cat" [options]="categoryOpts()" [(ngModel)]="categoryId" />
            </div>
          </div>
          <div class="row wrap">
            @if (kind() === 'overview') { <label class="check"><input type="checkbox" [(ngModel)]="includeLoans" /> Include lending & borrowing page</label> }
            <label class="check"><input type="checkbox" [(ngModel)]="redact" /> Remove personal details (names, notes, references)</label>
          </div>
        </app-filter-sheet>
      </div>
      @if (range()[0] > range()[1]) { <p class="err">The start date is after the end date.</p> }
    </section>

    @if (report(); as r) {
      <section class="stats">
        <div class="stat card"><span>Expenses</span><b class="neg">{{ r.totals.expense | money }}</b></div>
        <div class="stat card"><span>Income</span><b class="pos">{{ r.totals.income | money }}</b></div>
        <div class="stat card"><span>Net cash flow</span><b>{{ r.totals.net | money }}</b></div>
        <div class="stat card"><span>Avg. daily spend</span><b>{{ r.avgDailySpend | money }}</b></div>
        <div class="stat card"><span>Records in period</span><b>{{ r.rows.length }}</b></div>
        <div class="stat card"><span>Owed to me / I owe</span><b>{{ r.loanTotals.owedToMe | money }} / {{ r.loanTotals.iOwe | money }}</b></div>
      </section>
      <div class="row wrap">
        <button class="btn primary" (click)="pdf(false)"><app-icon name="download" /> Download PDF</button>
        <button class="btn ghost" (click)="csv(false)"><app-icon name="download" /> Download CSV</button>
        @if (mobile) {
          <button class="btn ghost" (click)="pdf(true)"><app-icon name="share" /> Share PDF</button>
          <button class="btn ghost" (click)="csv(true)"><app-icon name="share" /> Share CSV</button>
        }
      </div>
      <p class="muted small">Reports are generated on this device. Nothing is uploaded.</p>
    }
  `,
})
export class Reports {
  protected readonly lookups = inject(Lookups);
  private readonly repo = inject(Repo);
  private readonly ui = inject(Ui);
  protected readonly mobile = inject(Pwa).isIos || inject(Pwa).isAndroid;

  protected readonly mode = signal<'month' | 'range'>('month');
  protected readonly month = signal(thisMonth());
  protected readonly from = signal(monthRange(thisMonth())[0]);
  protected readonly to = signal(today());
  protected readonly kind = signal<ReportKind>('overview');
  protected readonly accountId = signal('');
  protected readonly categoryId = signal('');
  protected readonly includeLoans = signal(true);
  protected readonly redact = signal(false);

  protected readonly kindOpts: SelectOption[] = [
    { value: 'overview', label: 'Combined overview' },
    { value: 'expense', label: 'Expenses only' },
    { value: 'income', label: 'Income only' },
    { value: 'loans', label: 'Lending & borrowing' },
  ];
  protected readonly accountOpts = computed(() => toOptions(this.lookups.accounts(), 'All banks & accounts'));
  protected readonly categoryOpts = computed(() =>
    toOptions(this.lookups.categories().map((c) => ({ id: c.id, name: c.kind === 'income' ? `${c.name} (income)` : c.name })), 'All categories'),
  );
  protected readonly activeFilters = computed(() => [this.kind() !== 'overview', this.accountId(), this.categoryId(), this.kind() === 'overview' && !this.includeLoans(), this.redact()].filter(Boolean).length);
  protected readonly summary = computed(() =>
    [
      this.kindOpts.find((k) => k.value === this.kind())?.label,
      this.accountOpts().find((a) => a.value === this.accountId())?.label,
      this.categoryOpts().find((c) => c.value === this.categoryId())?.label,
    ].join(' · '),
  );

  protected readonly range = computed<[string, string]>(() => (this.mode() === 'month' ? monthRange(this.month()) : [this.from(), this.to()]));

  private readonly input = load(
    () => ({ r: this.range(), rev: this.repo.rev() }),
    async ({ r: [from, to] }) => {
      if (!from || !to || from > to) return null;
      const [pf, pt] = previousPeriod(from, to);
      const [txs, prevTxs, loanRecords] = await Promise.all([this.repo.range(from, to), this.repo.range(pf, pt), this.repo.loanRecords()]);
      return { txs, prevTxs, loanRecords };
    },
    null,
  );

  protected readonly report = computed(() => {
    const i = this.input();
    const [from, to] = this.range();
    if (!i || from > to) return null;
    return buildReport(
      { ...i, accounts: this.lookups.accounts(), categories: this.lookups.categories(), today: today() },
      {
        from,
        to,
        kind: this.kind(),
        accountId: this.accountId() || undefined,
        categoryId: this.categoryId() || undefined,
        includeLoans: this.includeLoans(),
        redact: this.redact(),
      },
    );
  });

  protected reset() {
    this.kind.set('overview');
    this.accountId.set('');
    this.categoryId.set('');
    this.includeLoans.set(true);
    this.redact.set(false);
  }

  private get fileBase() {
    const [from, to] = this.range();
    return `report-${this.kind()}-${from}_to_${to}`;
  }

  // Generation is synchronous so the click's user activation is still valid for navigator.share (iOS).
  protected pdf(share: boolean) {
    const r = this.report();
    if (!r) return;
    try {
      shareOrDownload(renderPdf(r), `${this.fileBase}.pdf`, share);
    } catch (e) {
      this.ui.error(e);
    }
  }

  protected csv(share: boolean) {
    const r = this.report();
    if (!r) return;
    const blob = new Blob(['﻿' + toCsv(r.rows, this.lookups.currency().code, r.opts.redact)], { type: 'text/csv' });
    shareOrDownload(blob, `${this.fileBase}.csv`, share);
  }
}
