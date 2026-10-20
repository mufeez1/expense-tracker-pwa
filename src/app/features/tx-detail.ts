import { Component, computed, DestroyRef, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { DatePipe, Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { formatBytes } from '../core/attachments';
import { dateLabel, today } from '../core/dates';
import { LOAN_STATUS_LABEL, LoanView, loanViews } from '../core/finance';
import { Lookups } from '../core/lookups';
import { Attachment, PAYMENT_METHODS, Tx, TX_LABEL } from '../core/models';
import { Repo } from '../core/repo';
import { load, MoneyPipe, Ui } from '../core/ui';
import { Icon } from '../shared/icon';

interface Shown extends Attachment {
  url: string;
}

@Component({
  selector: 'app-tx-detail',
  imports: [RouterLink, MoneyPipe, Icon, DatePipe],
  template: `
    <header class="page-head">
      <button class="icon-btn" (click)="location.back()" aria-label="Back"><app-icon name="back" /></button>
      <h1>{{ data()?.tx?.title ?? 'Record' }}</h1>
    </header>

    @if (data(); as d) {
      @if (d.tx; as t) {
        <section class="card detail">
          <div class="detail-amount" [class]="t.type">{{ t.amount | money }}</div>
          <div class="row wrap">
            <span class="badge" [class]="t.type">{{ label[t.type] }}</span>
            @if (d.view) { <span class="badge" [class]="d.view.status">{{ status[d.view.status] }}</span> }
          </div>
          <dl class="kv">
            <dt>Date</dt><dd>{{ dateLabel(t.date) }} {{ t.time ?? '' }}</dd>
            @if (t.categoryId) { <dt>{{ t.type === 'income' ? 'Source' : 'Category' }}</dt><dd>{{ lookups.catName().get(t.categoryId) ?? '—' }}{{ t.subcategory ? ' · ' + t.subcategory : '' }}</dd> }
            @if (t.type === 'transfer') {
              <dt>From</dt><dd>{{ lookups.accName().get(t.accountId!) }}</dd>
              <dt>To</dt><dd>{{ lookups.accName().get(t.toAccountId!) }}</dd>
            } @else if (t.accountId) {
              <dt>Account</dt><dd>{{ lookups.accName().get(t.accountId) }}</dd>
            }
            @if (t.paymentMethod) { <dt>Method</dt><dd>{{ method(t.paymentMethod) }}</dd> }
            @if (t.counterparty) { <dt>{{ t.type === 'expense' ? 'Merchant' : t.type === 'income' ? 'Payer' : 'Person' }}</dt><dd>{{ t.counterparty }}</dd> }
            @if (t.dueDate) { <dt>Due</dt><dd>{{ dateLabel(t.dueDate) }}</dd> }
            @if (t.contact) { <dt>Contact</dt><dd>{{ t.contact }}</dd> }
            @if (t.reference) { <dt>Reference</dt><dd>{{ t.reference }}</dd> }
            @if (t.tags.length) { <dt>Tags</dt><dd>{{ t.tags.join(', ') }}</dd> }
            @if (d.loan) { <dt>Loan</dt><dd><a [routerLink]="['/tx', d.loan.id]">{{ d.loan.title }}</a></dd> }
            <dt>Updated</dt><dd>{{ t.updatedAt | date: 'medium' }}</dd>
          </dl>
          @if (t.notes) { <p class="notes">{{ t.notes }}</p> }
          <div class="row">
            <a class="btn ghost" [routerLink]="['/tx', t.id, 'edit']"><app-icon name="edit" /> Edit</a>
            <button class="btn danger ghost" (click)="remove(t, d.view)"><app-icon name="delete" /> Delete</button>
          </div>
        </section>

        @if (d.view; as v) {
          <section class="card">
            <h2>Repayments</h2>
            <div class="stats three">
              <div class="stat"><span>Original</span><b>{{ v.loan.amount | money }}</b></div>
              <div class="stat"><span>Repaid</span><b class="pos">{{ v.repaid | money }}</b></div>
              <div class="stat"><span>Remaining</span><b [class.neg]="v.remaining > 0">{{ v.remaining | money }}</b></div>
            </div>
            <ul class="list">
              @for (r of v.repayments; track r.id) {
                <li><a class="tx-line" [routerLink]="['/tx', r.id]">
                  <span>{{ dateLabel(r.date) }}{{ r.notes ? ' · ' + r.notes : '' }}</span><b>{{ r.amount | money }}</b>
                </a></li>
              } @empty { <li class="muted">No repayments yet.</li> }
            </ul>
            @if (v.remaining > 0) {
              <a class="btn primary" [routerLink]="['/new/repayment']" [queryParams]="{ loanId: t.id }">Record repayment</a>
            }
          </section>
        }

        <section class="card">
          <h2>Attachments</h2>
          <div class="attach-grid">
            @for (a of shown(); track a.id) {
              <button class="thumb" (click)="open(a)" [attr.aria-label]="'Open ' + a.name">
                @if (a.type === 'application/pdf') { <app-icon name="doc" /> } @else { <img [src]="a.url" alt="" /> }
                <span class="name">{{ a.name }} · {{ size(a.size) }}</span>
              </button>
            } @empty { <p class="muted">No attachments. Use Edit to add a screenshot or receipt.</p> }
          </div>
        </section>
      } @else {
        <p class="empty">This record was not found. <a routerLink="/transactions">Back to transactions</a></p>
      }
    }

    <dialog #viewer class="viewer" (click)="viewer.close()" aria-label="Attachment preview">
      @if (viewing(); as a) {
        <img [src]="a.url" [alt]="a.name" />
        <button class="icon-btn close" aria-label="Close"><app-icon name="close" /></button>
      }
    </dialog>
  `,
})
export class TxDetail {
  readonly id = input.required<string>();
  protected readonly lookups = inject(Lookups);
  protected readonly location = inject(Location);
  private readonly repo = inject(Repo);
  private readonly ui = inject(Ui);
  private readonly router = inject(Router);
  private readonly viewer = viewChild.required<ElementRef<HTMLDialogElement>>('viewer');

  protected readonly label = TX_LABEL;
  protected readonly status = LOAN_STATUS_LABEL;
  protected readonly dateLabel = dateLabel;
  protected readonly size = formatBytes;
  protected readonly viewing = signal<Shown | null>(null);
  private urls: string[] = [];

  protected readonly data = load(
    () => ({ id: this.id(), rev: this.repo.rev() }),
    async ({ id }) => {
      const tx = await this.repo.getTx(id);
      if (!tx) return { tx: undefined };
      const atts = await this.repo.attachmentsOf(id);
      let view: LoanView | undefined;
      let loan: Tx | undefined;
      if (tx.type === 'lend' || tx.type === 'borrow') view = loanViews([tx, ...(await this.repo.repaymentsOf(id))], today())[0];
      if (tx.type === 'repayment' && tx.loanId) loan = await this.repo.getTx(tx.loanId);
      this.revoke();
      const shown: Shown[] = [];
      for (const a of atts) {
        const blob = await this.repo.blob(a.id);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        this.urls.push(url);
        shown.push({ ...a, url });
      }
      return { tx, view, loan, shown };
    },
    null as null | { tx?: Tx; view?: LoanView; loan?: Tx; shown?: Shown[] },
  );
  protected readonly shown = computed(() => this.data()?.shown ?? []);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.revoke());
  }

  private revoke() {
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls = [];
  }

  protected method(id: string) {
    return PAYMENT_METHODS.find((p) => p.id === id)?.name ?? id;
  }

  protected open(a: Shown) {
    if (a.type === 'application/pdf') {
      window.open(a.url, '_blank');
      return;
    }
    this.viewing.set(a);
    this.viewer().nativeElement.showModal();
  }

  protected async remove(t: Tx, view?: LoanView) {
    const extra = view?.repayments.length ? ` Its ${view.repayments.length} repayment record(s) will also be deleted.` : '';
    if (!(await this.ui.confirm(`Delete "${t.title}"?${extra} This cannot be undone.`))) return;
    try {
      await this.repo.deleteTx(t.id);
      this.ui.toast('Deleted.');
      this.router.navigateByUrl(t.type === 'lend' || t.type === 'borrow' ? '/loans' : '/transactions', { replaceUrl: true });
    } catch (e) {
      this.ui.error(e);
    }
  }
}
