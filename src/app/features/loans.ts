import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { addDays, dateLabel, today } from '../core/dates';
import { LOAN_STATUS_LABEL, LoanStatus, loanTotals, loanViews } from '../core/finance';
import { Tx } from '../core/models';
import { Repo } from '../core/repo';
import { load, MoneyPipe } from '../core/ui';
import { Icon } from '../shared/icon';

const STATUS_ORDER: Record<LoanStatus, number> = { overdue: 0, partial: 1, outstanding: 2, repaid: 3 };

@Component({
  selector: 'app-loans',
  imports: [RouterLink, MoneyPipe, Icon],
  template: `
    <header class="page-head">
      <h1>People & Loans</h1>
      <div class="row">
        <a class="btn primary sm" routerLink="/new/lend"><app-icon name="add" /> Lend</a>
        <a class="btn ghost sm" routerLink="/new/borrow"><app-icon name="add" /> Borrow</a>
        <a class="btn ghost sm" routerLink="/new/repayment">Repayment</a>
      </div>
    </header>

    <section class="stats">
      <div class="stat card"><span>Total lent</span><b>{{ t().lent | money }}</b></div>
      <div class="stat card"><span>Returned to me</span><b class="pos">{{ t().returnedToMe | money }}</b></div>
      <div class="stat card"><span>Still owed to me</span><b class="pos">{{ t().owedToMe | money }}</b>
        @if (t().overdueToMe) { <small class="neg">{{ t().overdueToMe | money }} overdue</small> }</div>
      <div class="stat card"><span>Total borrowed</span><b>{{ t().borrowed | money }}</b></div>
      <div class="stat card"><span>I have repaid</span><b>{{ t().repaidByMe | money }}</b></div>
      <div class="stat card"><span>I still owe</span><b class="neg">{{ t().iOwe | money }}</b>
        @if (t().overdueByMe) { <small class="neg">{{ t().overdueByMe | money }} overdue</small> }</div>
    </section>
    <p class="muted small">Loans are not counted as income or expenses. Balances come from linked repayment records.</p>

    @if (upcoming().length) {
      <section class="card">
        <h2>Due soon & overdue</h2>
        <ul class="list">
          @for (v of upcoming(); track v.loan.id) {
            <li><a class="tx-line" [routerLink]="['/tx', v.loan.id]">
              <span>{{ v.loan.type === 'lend' ? 'From' : 'To' }} {{ v.loan.counterparty }} · due {{ dateLabel(v.loan.dueDate!) }}
                <span class="badge" [class]="v.status">{{ status[v.status] }}</span></span>
              <b>{{ v.remaining | money }}</b>
            </a></li>
          }
        </ul>
      </section>
    }

    <div class="tabs" role="tablist">
      <button role="tab" [attr.aria-selected]="tab() === 'lend'" [class.on]="tab() === 'lend'" (click)="tab.set('lend')">Money I lent</button>
      <button role="tab" [attr.aria-selected]="tab() === 'borrow'" [class.on]="tab() === 'borrow'" (click)="tab.set('borrow')">Money I borrowed</button>
    </div>

    @if (people().length) {
      <section class="card">
        <h2>By person</h2>
        <ul class="list">
          @for (p of people(); track p.name) {
            <li class="tx-line"><span>{{ p.name }} <small class="muted">{{ p.count }} loan(s)</small></span><b>{{ p.remaining | money }}</b></li>
          }
        </ul>
      </section>
    }

    <section class="card">
      <table class="table loan-table">
        <thead><tr><th>Person</th><th>Date</th><th class="num">Original</th><th class="num">Repaid</th><th class="num">Remaining</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>
          @for (v of list(); track v.loan.id) {
            <tr>
              <td class="c-title"><a [routerLink]="['/tx', v.loan.id]">{{ v.loan.counterparty }}</a><small>{{ v.loan.title }}</small></td>
              <td class="c-date">{{ dateLabel(v.loan.date) }}</td>
              <td class="num" data-label="Original">{{ v.loan.amount | money }}</td>
              <td class="num" data-label="Repaid">{{ v.repaid | money }}</td>
              <td class="num amount" data-label="Remaining">{{ v.remaining | money }}</td>
              <td data-label="Due">{{ v.loan.dueDate ? dateLabel(v.loan.dueDate) : '—' }}</td>
              <td><span class="badge" [class]="v.status">{{ status[v.status] }}</span></td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="empty">No {{ tab() === 'lend' ? 'money lent' : 'borrowing' }} recorded.</td></tr>
          }
        </tbody>
      </table>
    </section>
  `,
})
export class Loans {
  private readonly repo = inject(Repo);
  protected readonly status = LOAN_STATUS_LABEL;
  protected readonly dateLabel = dateLabel;
  protected readonly tab = signal<'lend' | 'borrow'>('lend');

  private readonly records = load(() => this.repo.rev(), () => this.repo.loanRecords(), [] as Tx[]);
  private readonly views = computed(() => loanViews(this.records(), today()));
  protected readonly t = computed(() => loanTotals(this.views()));
  protected readonly list = computed(() =>
    this.views()
      .filter((v) => v.loan.type === this.tab())
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.loan.date.localeCompare(a.loan.date)),
  );
  protected readonly upcoming = computed(() => {
    const soon = addDays(today(), 30);
    return this.views()
      .filter((v) => v.remaining > 0 && v.loan.dueDate && v.loan.dueDate <= soon)
      .sort((a, b) => a.loan.dueDate!.localeCompare(b.loan.dueDate!));
  });
  protected readonly people = computed(() => {
    const map = new Map<string, { name: string; remaining: number; count: number }>();
    for (const v of this.list()) {
      const name = v.loan.counterparty ?? '';
      const p = map.get(name.toLowerCase()) ?? { name, remaining: 0, count: 0 };
      p.remaining += v.remaining;
      p.count++;
      map.set(name.toLowerCase(), p);
    }
    return [...map.values()].filter((p) => p.remaining > 0).sort((a, b) => b.remaining - a.remaining);
  });
}
