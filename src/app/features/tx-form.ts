import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { today } from '../core/dates';
import { LoanView, loanViews } from '../core/finance';
import { Lookups } from '../core/lookups';
import { Attachment, PAYMENT_METHODS, PaymentMethod, Tx, TX_TYPES, TxType, uid } from '../core/models';
import { formatMoney, parseMoney, toAmountInput } from '../core/money';
import { Repo } from '../core/repo';
import { MoneyPipe, Ui } from '../core/ui';
import { AttachmentPicker, Pending } from '../shared/attachment-picker';
import { Icon } from '../shared/icon';
import { Select, toOptions } from '../shared/select';

const amountValidator = (c: AbstractControl): ValidationErrors | null => (parseMoney(c.value) ? null : { amount: true });

const HEADINGS: Record<TxType, string> = {
  expense: 'Expense',
  income: 'Income',
  lend: 'Lend money',
  borrow: 'Borrow money',
  repayment: 'Record repayment',
  transfer: 'Transfer between accounts',
};

@Component({
  selector: 'app-tx-form',
  imports: [ReactiveFormsModule, AttachmentPicker, Icon, MoneyPipe, RouterLink, Select],
  template: `
    <header class="page-head">
      <button class="icon-btn" type="button" (click)="location.back()" aria-label="Back"><app-icon name="back" /></button>
      <h1>{{ existing ? 'Edit' : '' }} {{ heading() }}</h1>
    </header>

    @if (kind(); as k) {
      <form class="card form" [formGroup]="form" (ngSubmit)="save()" novalidate>
        <div class="field amount-field">
          <label for="amount">Amount ({{ lookups.currency().symbol }})</label>
          <input id="amount" formControlName="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" autofocus
                 [attr.aria-invalid]="bad('amount')" aria-describedby="amount-err" />
          @if (bad('amount')) {
            <span class="err" id="amount-err">Enter an amount greater than zero, with up to 2 decimals.</span>
          }
          @if (k === 'repayment' && selectedLoan(); as v) {
            <span class="hint">Remaining on this loan: {{ remainingFor(v) | money }}</span>
          }
        </div>

        @if (k === 'repayment') {
          <div class="field">
            <label for="loanId">Loan being repaid</label>
            <app-select inputId="loanId" formControlName="loanId" [options]="loanOptions()" [invalid]="bad('loanId')" />
            @if (bad('loanId')) { <span class="err">Choose a loan.</span> }
            @if (!loanOptions().length) { <span class="hint">No outstanding loans. <a routerLink="/new/lend">Lend</a> or <a routerLink="/new/borrow">borrow</a> first.</span> }
          </div>
        }

        @if (k === 'lend' || k === 'borrow') {
          <div class="field">
            <label for="counterparty">{{ k === 'lend' ? 'Person you lent to' : 'Person you borrowed from' }}</label>
            <input id="counterparty" formControlName="counterparty" list="people" autocomplete="off" [attr.aria-invalid]="bad('counterparty')" />
            <datalist id="people">@for (p of people(); track p) { <option [value]="p"></option> }</datalist>
            @if (bad('counterparty')) { <span class="err">Enter the person's name.</span> }
          </div>
        }

        <div class="form-grid">
          <div class="field">
            <label for="date">Date</label>
            <input id="date" type="date" formControlName="date" [attr.aria-invalid]="bad('date')" />
            @if (bad('date')) { <span class="err">Pick a date.</span> }
          </div>

          @if (k === 'expense' || k === 'income') {
            <div class="field">
              <label for="categoryId">{{ k === 'expense' ? 'Category' : 'Income source' }}</label>
              <app-select inputId="categoryId" formControlName="categoryId" [options]="k === 'expense' ? expenseCatOpts() : incomeCatOpts()" [invalid]="bad('categoryId')" />
              @if (bad('categoryId')) { <span class="err">Choose a {{ k === 'expense' ? 'category' : 'source' }}.</span> }
            </div>
          }

          <div class="field">
            <label for="accountId">{{ accountLabel() }}</label>
            <app-select inputId="accountId" formControlName="accountId" [invalid]="bad('accountId')"
                        [options]="accountOpts(form.controls.accountId.value, k === 'transfer' ? undefined : 'Not specified')" />
            @if (bad('accountId')) { <span class="err">Choose the source account.</span> }
          </div>

          @if (k === 'transfer') {
            <div class="field">
              <label for="toAccountId">To account</label>
              <app-select inputId="toAccountId" formControlName="toAccountId" [options]="accountOpts(form.controls.toAccountId.value)" [invalid]="bad('toAccountId')" />
              @if (bad('toAccountId')) { <span class="err">Choose a different destination account.</span> }
            </div>
          } @else {
            <div class="field">
              <label for="paymentMethod">Payment method</label>
              <app-select inputId="paymentMethod" formControlName="paymentMethod" [options]="methodOpts" />
            </div>
          }

          @if (k === 'expense' || k === 'income') {
            <div class="field">
              <label for="counterparty">{{ k === 'expense' ? 'Merchant / recipient' : 'Payer' }}</label>
              <input id="counterparty" formControlName="counterparty" autocomplete="off" />
            </div>
          }

          @if (k === 'lend' || k === 'borrow') {
            <div class="field">
              <label for="dueDate">{{ k === 'lend' ? 'Expected repayment date' : 'Due date' }} (optional)</label>
              <input id="dueDate" type="date" formControlName="dueDate" />
            </div>
          }
        </div>

        <div class="field">
          <label for="title">{{ k === 'lend' || k === 'borrow' ? 'Reason' : 'Title' }} <span class="muted">(optional — filled in automatically)</span></label>
          <input id="title" formControlName="title" maxlength="200" autocomplete="off" />
        </div>

        <details class="more" [open]="hasExtras()">
          <summary>More details</summary>
          <div class="form-grid">
            <div class="field">
              <label for="time">Time</label>
              <input id="time" type="time" formControlName="time" />
            </div>
            @if (k === 'expense') {
              <div class="field">
                <label for="subcategory">Subcategory</label>
                <input id="subcategory" formControlName="subcategory" maxlength="200" />
              </div>
            }
            <div class="field">
              <label for="reference">Transaction reference</label>
              <input id="reference" formControlName="reference" maxlength="200" autocomplete="off" />
            </div>
            @if (k === 'lend' || k === 'borrow') {
              <div class="field">
                <label for="contact">Phone / contact notes</label>
                <input id="contact" formControlName="contact" maxlength="200" />
              </div>
            }
            <div class="field">
              <label for="tags">Tags <span class="muted">(comma separated)</span></label>
              <input id="tags" formControlName="tags" autocomplete="off" />
            </div>
          </div>
          <div class="field">
            <label for="notes">Notes</label>
            <textarea id="notes" formControlName="notes" rows="3" maxlength="5000"></textarea>
          </div>
        </details>

        <fieldset class="field">
          <legend>Payment proof / receipts</legend>
          <app-attachment-picker [existing]="attachments()" [(pending)]="pending" [(removed)]="removed" />
        </fieldset>

        <div class="row end sticky-actions">
          <button type="button" class="btn ghost" (click)="location.back()">Cancel</button>
          <button type="submit" class="btn primary" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save' }}</button>
        </div>
      </form>
    }
  `,
})
export class TxForm implements OnInit {
  readonly type = input<string>();
  readonly id = input<string>();
  readonly loanId = input<string>();

  protected readonly lookups = inject(Lookups);
  protected readonly location = inject(Location);
  private readonly repo = inject(Repo);
  private readonly ui = inject(Ui);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly methodOpts = toOptions(PAYMENT_METHODS, 'Not specified');
  protected readonly kind = signal<TxType | null>(null);
  protected readonly heading = computed(() => (this.kind() ? HEADINGS[this.kind()!] : ''));
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly attachments = signal<Attachment[]>([]);
  protected readonly loans = signal<LoanView[]>([]);
  protected pending = signal<Pending[]>([]);
  protected removed = signal<string[]>([]);
  protected existing?: Tx;

  protected readonly form = this.fb.group({
    amount: ['', amountValidator],
    title: [''],
    date: [today(), Validators.required],
    time: [''],
    categoryId: [''],
    subcategory: [''],
    accountId: [''],
    toAccountId: [''],
    paymentMethod: [''],
    counterparty: [''],
    reference: [''],
    notes: [''],
    tags: [''],
    loanId: [''],
    dueDate: [''],
    contact: [''],
  });
  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected readonly selectedLoan = computed(() => this.loans().find((v) => v.loan.id === this.value().loanId));
  protected readonly loanOptions = computed(() =>
    this.loans()
      .filter((v) => v.remaining > 0 || v.loan.id === this.existing?.loanId)
      .map((v) => ({
        value: v.loan.id,
        label: `${v.loan.type === 'lend' ? 'Owed to me by' : 'I owe'} ${v.loan.counterparty} — ${formatMoney(v.remaining)} left`,
      })),
  );
  protected readonly expenseCatOpts = computed(() => toOptions(this.lookups.expenseCats()));
  protected readonly incomeCatOpts = computed(() => toOptions(this.lookups.incomeCats()));
  protected readonly people = computed(() => [...new Set(this.loans().map((v) => v.loan.counterparty ?? ''))].filter(Boolean).sort());

  protected readonly accountLabel = computed(() => {
    const k = this.kind();
    const lendRepay = k === 'repayment' && this.selectedLoan()?.loan.type === 'lend';
    if (k === 'transfer') return 'From account';
    return k === 'income' || k === 'borrow' || lendRepay ? 'Received into' : 'Paid from';
  });

  async ngOnInit() {
    try {
      if (this.id()) {
        const tx = await this.repo.getTx(this.id()!);
        if (!tx) {
          this.ui.toast('That record no longer exists.', true);
          this.router.navigateByUrl('/transactions');
          return;
        }
        this.existing = tx;
        this.kind.set(tx.type);
        this.form.patchValue({
          ...Object.fromEntries(Object.entries(tx).map(([k, v]) => [k, v ?? ''])),
          amount: toAmountInput(tx.amount),
          tags: tx.tags.join(', '),
        });
        this.attachments.set(await this.repo.attachmentsOf(tx.id));
      } else {
        const t = this.type() as TxType;
        if (!TX_TYPES.includes(t)) {
          this.router.navigateByUrl('/');
          return;
        }
        this.kind.set(t);
        this.restoreDraft();
        if (this.loanId()) this.form.patchValue({ loanId: this.loanId() });
      }
      this.configureValidators();
      if (this.kind() === 'repayment' || this.kind() === 'lend' || this.kind() === 'borrow') {
        this.loans.set(loanViews(await this.repo.loanRecords(), today()));
        if (!this.existing) this.loanPicked();
        this.form.controls.loanId.valueChanges.subscribe(() => this.loanPicked());
      }
      if (!this.existing) this.form.valueChanges.subscribe(() => this.saveDraft());
    } catch (e) {
      this.ui.error(e);
    }
  }

  private configureValidators() {
    const k = this.kind()!;
    const c = this.form.controls;
    const req = (ctrl: AbstractControl) => {
      ctrl.addValidators(Validators.required);
      ctrl.updateValueAndValidity({ emitEvent: false });
    };
    if (k === 'expense' || k === 'income') req(c.categoryId);
    if (k === 'lend' || k === 'borrow') req(c.counterparty);
    if (k === 'repayment') req(c.loanId);
    if (k === 'transfer') {
      req(c.accountId);
      c.toAccountId.addValidators((ctl) => (!ctl.value || ctl.value === c.accountId.value ? { to: true } : null));
      c.accountId.valueChanges.subscribe(() => c.toAccountId.updateValueAndValidity({ emitEvent: false }));
    }
  }

  protected bad(name: keyof typeof this.form.controls) {
    const ctl = this.form.controls[name];
    return ctl.invalid && (ctl.touched || this.submitted());
  }

  protected hasExtras() {
    const v = this.form.getRawValue();
    return !!(v.time || v.subcategory || v.reference || v.contact || v.tags || v.notes);
  }

  /** Active accounts, plus the currently selected one even if it was deactivated later. */
  protected accountOpts(selected: string, empty?: string) {
    return toOptions(this.lookups.accounts().filter((a) => a.active || a.id === selected), empty);
  }

  protected remainingFor(v: LoanView) {
    // When editing, this repayment's own amount is still available to it.
    return v.remaining + (this.existing?.loanId === v.loan.id ? this.existing.amount : 0);
  }

  protected loanPicked() {
    const v = this.selectedLoan();
    if (v && !this.form.controls.amount.value) this.form.patchValue({ amount: toAmountInput(this.remainingFor(v)) });
  }

  async save() {
    this.submitted.set(true);
    this.form.markAllAsTouched();
    const k = this.kind()!;
    const v = this.form.getRawValue();
    const amount = parseMoney(v.amount) ?? 0;
    const loan = this.selectedLoan();
    if (k === 'repayment' && loan && amount > this.remainingFor(loan)) {
      this.form.controls.amount.setErrors({ amount: true });
      this.ui.toast(`Repayment can't exceed the remaining ${formatMoney(this.remainingFor(loan))}.`, true);
    }
    if (this.form.invalid) {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }

    const opt = (s: string) => s.trim() || undefined;
    const accName = this.lookups.accName();
    const person = k === 'repayment' ? loan?.loan.counterparty : opt(v.counterparty);
    const autoTitle = {
      expense: this.lookups.catName().get(v.categoryId) ?? 'Expense',
      income: this.lookups.catName().get(v.categoryId) ?? 'Income',
      lend: `Lent to ${person}`,
      borrow: `Borrowed from ${person}`,
      repayment: loan?.loan.type === 'lend' ? `Repayment from ${person}` : `Repayment to ${person}`,
      transfer: `${accName.get(v.accountId)} → ${accName.get(v.toAccountId)}`,
    }[k];

    const tx: Tx = {
      id: this.existing?.id ?? uid(),
      type: k,
      title: opt(v.title) ?? autoTitle,
      amount,
      date: v.date,
      time: opt(v.time),
      categoryId: k === 'expense' || k === 'income' ? opt(v.categoryId) : undefined,
      subcategory: k === 'expense' ? opt(v.subcategory) : undefined,
      accountId: opt(v.accountId),
      toAccountId: k === 'transfer' ? opt(v.toAccountId) : undefined,
      paymentMethod: k === 'transfer' ? undefined : (opt(v.paymentMethod) as PaymentMethod | undefined),
      counterparty: person,
      reference: opt(v.reference),
      notes: opt(v.notes),
      tags: v.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 50),
      loanId: k === 'repayment' ? opt(v.loanId) : undefined,
      dueDate: k === 'lend' || k === 'borrow' ? opt(v.dueDate) : undefined,
      contact: k === 'lend' || k === 'borrow' ? opt(v.contact) : undefined,
      attachmentCount: 0,
      createdAt: this.existing?.createdAt ?? 0,
      updatedAt: 0,
    };

    this.saving.set(true);
    try {
      await this.repo.saveTx(tx, this.pending(), this.removed());
      this.clearDraft();
      this.ui.toast(`${HEADINGS[k].replace(/^Record /, '')} saved.`);
      this.router.navigate(['/tx', tx.id], { replaceUrl: true });
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.saving.set(false);
    }
  }

  // Unsaved input survives accidental navigation (attachments excluded).
  private get draftKey() {
    return `draft:${this.kind()}`;
  }
  private saveDraft() {
    try {
      localStorage.setItem(this.draftKey, JSON.stringify(this.form.getRawValue()));
    } catch {}
  }
  private restoreDraft() {
    try {
      const d = localStorage.getItem(this.draftKey);
      if (d) this.form.patchValue(JSON.parse(d));
    } catch {}
  }
  private clearDraft() {
    try {
      localStorage.removeItem(this.draftKey);
    } catch {}
  }
}
