import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { dateLabel } from '../core/dates';
import { accountBalance } from '../core/finance';
import { Lookups } from '../core/lookups';
import { Account, ACCOUNT_KINDS, AccountKind, uid } from '../core/models';
import { parseMoney, toAmountInput } from '../core/money';
import { Repo } from '../core/repo';
import { load, MoneyPipe, Ui } from '../core/ui';
import { Icon } from '../shared/icon';
import { Select, toOptions } from '../shared/select';

@Component({
  selector: 'app-accounts',
  imports: [ReactiveFormsModule, MoneyPipe, Icon, Select],
  template: `
    <header class="page-head">
      <h1>Banks & accounts</h1>
      <button class="btn primary sm" (click)="edit()"><app-icon name="add" /> Add account</button>
    </header>
    <p class="muted small">Balances are shown only for accounts with an opening balance: opening balance + income − expenses ± loans, repayments and transfers since the opening date.</p>

    <ul class="cards">
      @for (a of lookups.accounts(); track a.id) {
        <li class="card account" [class.inactive]="!a.active">
          <div class="row between">
            <div>
              <b>{{ a.name }}</b>
              <div class="muted small">{{ a.bankName }} · {{ kindName(a.kind) }}{{ a.nickname ? ' · ' + a.nickname : '' }}{{ a.last4 ? ' · •••• ' + a.last4 : '' }}</div>
            </div>
            @if (!a.active) { <span class="badge">Inactive</span> }
          </div>
          @if (balances().get(a.id); as bal) {
            <div class="balance">Balance <b>{{ bal.value | money }}</b> <span class="muted small">since {{ dateLabel(a.openingDate ?? '') }}</span></div>
          }
          <div class="row">
            <button class="btn ghost sm" (click)="edit(a)"><app-icon name="edit" /> Edit</button>
            <button class="btn ghost sm" (click)="toggle(a)">{{ a.active ? 'Deactivate' : 'Activate' }}</button>
            <button class="btn ghost sm danger" (click)="remove(a)"><app-icon name="delete" /> Delete</button>
          </div>
        </li>
      }
    </ul>

    <dialog #dlg class="confirm wide" aria-labelledby="acc-title">
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <h2 id="acc-title">{{ editing ? 'Edit account' : 'Add account' }}</h2>
        <p class="hint">Never enter PINs, passwords, full card numbers, CVV or online banking credentials.</p>
        <div class="form-grid">
          <div class="field"><label for="a-name">Display name</label><input id="a-name" formControlName="name" maxlength="100" />
            @if (form.controls.name.invalid && form.controls.name.touched) { <span class="err">Required.</span> }</div>
          <div class="field"><label for="a-bank">Bank name</label><input id="a-bank" formControlName="bankName" maxlength="100" /></div>
          <div class="field"><label for="a-kind">Account type</label>
            <app-select inputId="a-kind" formControlName="kind" [options]="kindOpts" /></div>
          <div class="field"><label for="a-nick">Nickname</label><input id="a-nick" formControlName="nickname" maxlength="100" /></div>
          <div class="field"><label for="a-last4">Last 4 digits (optional)</label><input id="a-last4" formControlName="last4" inputmode="numeric" maxlength="4" />
            @if (form.controls.last4.invalid) { <span class="err">Exactly 4 digits.</span> }</div>
          <div class="field"><label for="a-ob">Opening balance (optional)</label><input id="a-ob" formControlName="openingBalance" inputmode="decimal" />
            @if (form.controls.openingBalance.invalid) { <span class="err">Enter an amount like 15000 or -2500.50.</span> }</div>
          <div class="field"><label for="a-od">Opening date</label><input id="a-od" type="date" formControlName="openingDate" /></div>
        </div>
        <div class="row end">
          <button type="button" class="btn ghost" (click)="dlg.close()">Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </div>
      </form>
    </dialog>
  `,
})
export class Accounts {
  protected readonly lookups = inject(Lookups);
  private readonly repo = inject(Repo);
  private readonly ui = inject(Ui);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly kindOpts = toOptions(ACCOUNT_KINDS);
  protected readonly dateLabel = dateLabel;
  protected editing?: Account;

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', Validators.required],
    bankName: [''],
    kind: ['current' as AccountKind],
    nickname: [''],
    last4: ['', Validators.pattern(/^\d{4}$/)],
    openingBalance: ['', Validators.pattern(/^-?[\d,]+(\.\d{1,2})?$/)],
    openingDate: [''],
  });

  protected readonly balances = load(
    () => ({ accounts: this.lookups.accounts(), rev: this.repo.rev() }),
    async ({ accounts }) => {
      const out = new Map<string, { value: number }>();
      const withOpening = accounts.filter((a) => a.openingBalance !== undefined);
      if (!withOpening.length) return out;
      const loanType = new Map((await this.repo.loanRecords()).map((t) => [t.id, t.type]));
      for (const a of withOpening) {
        const v = accountBalance(a, await this.repo.accountTxs(a.id), (id) => loanType.get(id));
        if (v !== null) out.set(a.id, { value: v });
      }
      return out;
    },
    new Map<string, { value: number }>(),
  );

  protected kindName(k: AccountKind) {
    return ACCOUNT_KINDS.find((x) => x.id === k)?.name ?? k;
  }

  protected edit(a?: Account) {
    this.editing = a;
    const ob = a?.openingBalance;
    this.form.reset({
      name: a?.name ?? '',
      bankName: a?.bankName ?? '',
      kind: a?.kind ?? 'current',
      nickname: a?.nickname ?? '',
      last4: a?.last4 ?? '',
      openingBalance: ob === undefined ? '' : (ob < 0 ? '-' : '') + toAmountInput(Math.abs(ob)),
      openingDate: a?.openingDate ?? '',
    });
    this.dlg().nativeElement.showModal();
  }

  protected async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const neg = v.openingBalance.trim().startsWith('-');
    const ob = v.openingBalance.trim() ? parseMoney(v.openingBalance.replace('-', '')) : null;
    const accounts = this.lookups.accounts();
    const a: Account = {
      id: this.editing?.id ?? uid(),
      name: v.name.trim(),
      bankName: v.bankName.trim() || v.name.trim(),
      kind: v.kind,
      nickname: v.nickname.trim() || undefined,
      last4: v.last4 || undefined,
      openingBalance: ob === null ? undefined : neg ? -ob : ob,
      openingDate: ob === null ? undefined : v.openingDate || undefined,
      active: this.editing?.active ?? true,
      order: this.editing?.order ?? accounts.length,
    };
    try {
      await this.repo.saveAccount(a);
      this.dlg().nativeElement.close();
      this.ui.toast('Account saved.');
    } catch (e) {
      this.ui.error(e);
    }
  }

  protected async toggle(a: Account) {
    try {
      await this.repo.saveAccount({ ...a, active: !a.active });
    } catch (e) {
      this.ui.error(e);
    }
  }

  protected async remove(a: Account) {
    if (!(await this.ui.confirm(`Delete "${a.name}"?`))) return;
    try {
      await this.repo.deleteAccount(a.id);
      this.ui.toast('Account deleted.');
    } catch (e) {
      this.ui.error(e);
    }
  }
}
