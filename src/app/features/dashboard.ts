import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ChartConfiguration } from 'chart.js';
import { addMonths, monthLabel, monthRange, thisMonth, today } from '../core/dates';
import { groupBy, loanTotals, loanViews, periodLoanFlow, totals } from '../core/finance';
import { Lookups } from '../core/lookups';
import { Tx } from '../core/models';
import { formatMoney } from '../core/money';
import { Repo } from '../core/repo';
import { load, MoneyPipe, Ui } from '../core/ui';
import { ChartView, PALETTE } from '../shared/chart';
import { Icon } from '../shared/icon';
import { TxTable } from '../shared/tx-table';

const TREND_MONTHS = 6;

@Component({
  selector: 'app-dashboard',
  imports: [FormsModule, RouterLink, MoneyPipe, ChartView, Icon, TxTable],
  template: `
    <header class="page-head">
      <h1>Overview</h1>
      <div class="month-pick">
        <button class="icon-btn" (click)="shift(-1)" aria-label="Previous month"><app-icon name="back" /></button>
        <input type="month" [ngModel]="month()" (ngModelChange)="$event && month.set($event)" aria-label="Month" />
        <button class="icon-btn flip" (click)="shift(1)" aria-label="Next month"><app-icon name="back" /></button>
      </div>
      <button class="btn primary sm" (click)="ui.addSheetOpen.set(true)"><app-icon name="add" /> Quick add</button>
    </header>

    <section class="stats">
      <div class="stat card"><span>Expenses · {{ label() }}</span><b class="neg">{{ cur().expense | money }}</b>
        <small [class.neg]="mom() > 0" [class.pos]="mom() < 0">{{ momText() }}</small></div>
      <div class="stat card"><span>Income · {{ label() }}</span><b class="pos">{{ cur().income | money }}</b></div>
      <div class="stat card"><span>Net cash flow</span><b [class.neg]="cur().net < 0" [class.pos]="cur().net > 0">{{ cur().net | money }}</b></div>
      <div class="stat card"><span>Lent this month (net)</span><b>{{ flow().lending | money }}</b></div>
      <div class="stat card"><span>Borrowed this month (net)</span><b>{{ flow().borrowing | money }}</b></div>
      <a class="stat card" routerLink="/loans"><span>Owed to me</span><b class="pos">{{ loans().owedToMe | money }}</b></a>
      <a class="stat card" routerLink="/loans"><span>I owe others</span><b class="neg">{{ loans().iOwe | money }}</b></a>
    </section>
    <p class="muted small">Cash flow counts income and expenses only. Loans and transfers between your own accounts are tracked separately.</p>

    <div class="grid-2">
      <section class="card">
        <h2>Monthly trend</h2>
        <app-chart [config]="trendChart()" label="Income and expenses over the last six months" />
      </section>
      <section class="card">
        <h2>Spending by category</h2>
        @if (byCategory().length) {
          <app-chart [config]="categoryChart()" label="Spending by category" />
        } @else { <p class="empty">No expenses this month.</p> }
      </section>
      <section class="card">
        <h2>Spending by bank / account</h2>
        @if (byAccount().length) {
          <app-chart [config]="accountChart()" label="Spending by bank" />
        } @else { <p class="empty">No expenses this month.</p> }
      </section>
      <section class="card">
        <h2>Top 5 categories</h2>
        <ol class="rank">
          @for (g of byCategory().slice(0, 5); track g.key) {
            <li><span>{{ g.key }}</span><span class="bar"><i [style.width.%]="(g.total / byCategory()[0].total) * 100"></i></span><b>{{ g.total | money }}</b></li>
          } @empty { <li class="muted">No expenses this month.</li> }
        </ol>
      </section>
    </div>

    <section class="card">
      <div class="row between"><h2>Recent transactions</h2><a routerLink="/transactions">See all</a></div>
      @if (recent().length) { <app-tx-table [items]="recent()" /> } @else {
        <p class="empty">No records yet. Tap <b>+</b> to add your first expense.</p>
      }
    </section>

  `,
})
export class Dashboard {
  protected readonly ui = inject(Ui);
  private readonly repo = inject(Repo);
  private readonly lookups = inject(Lookups);
  protected readonly month = signal(thisMonth());
  protected readonly label = computed(() => monthLabel(this.month()));

  private readonly data = load(
    () => ({ m: this.month(), rev: this.repo.rev() }),
    async ({ m }) => {
      const [from] = monthRange(addMonths(m, -(TREND_MONTHS - 1)));
      const [, to] = monthRange(m);
      const [txs, loanRecs] = await Promise.all([this.repo.range(from, to), this.repo.loanRecords()]);
      return { txs, loanRecs };
    },
    { txs: [] as Tx[], loanRecs: [] as Tx[] },
  );
  protected readonly recent = load(() => this.repo.rev(), () => this.repo.query({}, 0, 8).then((r) => r.items), [] as Tx[]);

  private inMonth(ym: string) {
    return this.data().txs.filter((t) => t.date.startsWith(ym));
  }
  private readonly monthTxs = computed(() => this.inMonth(this.month()));
  protected readonly cur = computed(() => totals(this.monthTxs()));
  private readonly prev = computed(() => totals(this.inMonth(addMonths(this.month(), -1))));
  protected readonly mom = computed(() => (this.prev().expense ? ((this.cur().expense - this.prev().expense) / this.prev().expense) * 100 : 0));
  protected readonly momText = computed(() =>
    this.prev().expense
      ? `${this.mom() > 0 ? '▲' : '▼'} ${Math.abs(this.mom()).toFixed(1)}% vs ${monthLabel(addMonths(this.month(), -1))}`
      : 'No spending last month',
  );
  protected readonly loans = computed(() => loanTotals(loanViews(this.data().loanRecs, today())));
  protected readonly flow = computed(() => {
    const types = new Map(this.data().loanRecs.map((t) => [t.id, t.type]));
    return periodLoanFlow(this.monthTxs(), (id) => types.get(id));
  });
  protected readonly byCategory = computed(() =>
    groupBy(this.monthTxs(), 'expense', (t) => this.lookups.catName().get(t.categoryId ?? '') ?? 'Uncategorised'),
  );
  protected readonly byAccount = computed(() =>
    groupBy(this.monthTxs(), 'expense', (t) => this.lookups.accName().get(t.accountId ?? '') ?? 'Unspecified'),
  );

  protected readonly trendChart = computed<ChartConfiguration>(() => {
    const months = Array.from({ length: TREND_MONTHS }, (_, i) => addMonths(this.month(), i - TREND_MONTHS + 1));
    const t = months.map((m) => totals(this.inMonth(m)));
    return {
      type: 'bar',
      data: {
        labels: months.map(monthLabel),
        datasets: [
          { label: 'Expenses', data: t.map((x) => x.expense / 100), backgroundColor: '#dc4c4c' },
          { label: 'Income', data: t.map((x) => x.income / 100), backgroundColor: '#16a34a' },
        ],
      },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatMoney(Math.round((c.raw as number) * 100))}` } } } },
    };
  });
  protected readonly categoryChart = computed<ChartConfiguration>(() => ({
    type: 'doughnut',
    data: {
      labels: this.byCategory().map((g) => g.key),
      datasets: [{ data: this.byCategory().map((g) => g.total / 100), backgroundColor: PALETTE }],
    },
    options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.label}: ${formatMoney(Math.round((c.raw as number) * 100))}` } } } },
  }));
  protected readonly accountChart = computed<ChartConfiguration>(() => ({
    type: 'bar',
    data: {
      labels: this.byAccount().map((g) => g.key),
      datasets: [{ label: 'Spending', data: this.byAccount().map((g) => g.total / 100), backgroundColor: '#1e2a63' }],
    },
    options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatMoney(Math.round((c.raw as number) * 100)) } } } },
  }));

  protected shift(n: number) {
    this.month.set(addMonths(this.month(), n));
  }
}
