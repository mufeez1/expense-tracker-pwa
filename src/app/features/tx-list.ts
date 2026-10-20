import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Lookups } from '../core/lookups';
import { PAYMENT_METHODS, PaymentMethod, TX_LABEL, TX_TYPES, TxType } from '../core/models';
import { parseMoney } from '../core/money';
import { Repo, TxFilter } from '../core/repo';
import { load } from '../core/ui';
import { FilterSheet } from '../shared/filter-sheet';
import { Icon } from '../shared/icon';
import { Select, SelectOption, toOptions } from '../shared/select';
import { TxTable } from '../shared/tx-table';

const PAGE = 50;

@Component({
  selector: 'app-tx-list',
  imports: [FormsModule, RouterLink, Icon, TxTable, FilterSheet, Select],
  template: `
    <header class="page-head">
      <h1>{{ heading() }}</h1>
      @if (types()?.length === 1) {
        <a class="btn primary sm" [routerLink]="['/new', types()![0]]"><app-icon name="add" /> Add</a>
      }
    </header>

    <div class="toolbar">
      <div class="search">
        <app-icon name="search" />
        <input type="search" placeholder="Search title, merchant, person, reference, notes" [ngModel]="qInput()" (ngModelChange)="search($event)" aria-label="Search" />
      </div>
      <app-filter-sheet [active]="activeFilters()" (clear)="reset()">
        @if (!types()) {
          <div class="chips" role="group" aria-label="Type">
            @for (t of allTypes; track t) {
              <button type="button" class="chip" [class.on]="typeSel().includes(t)" [attr.aria-pressed]="typeSel().includes(t)" (click)="toggleType(t)">{{ label[t] }}</button>
            }
          </div>
        }
        <div class="form-grid">
          <div class="field"><label for="f-from">From</label><input id="f-from" type="date" [(ngModel)]="from" /></div>
          <div class="field"><label for="f-to">To</label><input id="f-to" type="date" [(ngModel)]="to" /></div>
          <div class="field">
            <label for="f-acc">Bank / account</label>
            <app-select inputId="f-acc" [options]="accountOpts()" [(ngModel)]="accountId" />
          </div>
          <div class="field">
            <label for="f-cat">Category</label>
            <app-select inputId="f-cat" [options]="categoryOpts()" [(ngModel)]="categoryId" />
          </div>
          <div class="field">
            <label for="f-pm">Payment method</label>
            <app-select inputId="f-pm" [options]="methodOpts" [(ngModel)]="paymentMethod" />
          </div>
          <div class="field"><label for="f-min">Min amount</label><input id="f-min" inputmode="decimal" [(ngModel)]="min" /></div>
          <div class="field"><label for="f-max">Max amount</label><input id="f-max" inputmode="decimal" [(ngModel)]="max" /></div>
          <div class="field">
            <label for="f-sort">Sort by</label>
            <app-select inputId="f-sort" [options]="sortOpts" [(ngModel)]="sort" />
          </div>
        </div>
        <div class="row wrap">
          <label class="check"><input type="checkbox" [(ngModel)]="asc" /> Ascending</label>
          <label class="check"><input type="checkbox" [(ngModel)]="hasAttachment" /> With attachments only</label>
        </div>
      </app-filter-sheet>
    </div>

    <p class="muted count">{{ result().total }} record{{ result().total === 1 ? '' : 's' }}</p>
    @if (result().items.length) {
      <app-tx-table [items]="result().items" />
      @if (result().items.length < result().total) {
        <button class="btn ghost block" (click)="limit.set(limit() + PAGE)">Load more</button>
      }
    } @else {
      <p class="empty">Nothing here yet.</p>
    }
  `,
})
export class TxList {
  readonly heading = input('Transactions');
  readonly types = input<TxType[]>();

  protected readonly lookups = inject(Lookups);
  private readonly repo = inject(Repo);
  protected readonly label = TX_LABEL;
  protected readonly allTypes = TX_TYPES;
  protected readonly methodOpts = toOptions(PAYMENT_METHODS, 'All');
  protected readonly sortOpts: SelectOption[] = [
    { value: 'date', label: 'Date' },
    { value: 'amount', label: 'Amount' },
    { value: 'title', label: 'Title' },
    { value: 'updated', label: 'Recently updated' },
  ];
  protected readonly accountOpts = computed(() => toOptions(this.lookups.accounts(), 'All'));
  protected readonly categoryOpts = computed(() =>
    toOptions(this.lookups.categories().map((c) => ({ id: c.id, name: c.kind === 'income' ? `${c.name} (income)` : c.name })), 'All'),
  );
  protected readonly PAGE = PAGE;

  protected readonly qInput = signal('');
  private readonly q = signal('');
  protected readonly typeSel = signal<TxType[]>([]);
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly accountId = signal('');
  protected readonly categoryId = signal('');
  protected readonly paymentMethod = signal('');
  protected readonly min = signal('');
  protected readonly max = signal('');
  protected readonly sort = signal<'date' | 'amount' | 'title' | 'updated'>('date');
  protected readonly asc = signal(false);
  protected readonly hasAttachment = signal(false);
  protected readonly limit = signal(PAGE);
  private timer?: ReturnType<typeof setTimeout>;

  private readonly filter = computed<TxFilter>(() => ({
    types: this.types() ?? (this.typeSel().length ? this.typeSel() : undefined),
    q: this.q() || undefined,
    from: this.from() || undefined,
    to: this.to() || undefined,
    accountId: this.accountId() || undefined,
    categoryId: this.categoryId() || undefined,
    paymentMethod: (this.paymentMethod() || undefined) as PaymentMethod | undefined,
    min: parseMoney(this.min()) ?? undefined,
    max: this.max() ? (parseMoney(this.max()) ?? undefined) : undefined,
    hasAttachment: this.hasAttachment() || undefined,
    sort: this.sort(),
    asc: this.asc(),
  }));

  protected readonly activeFilters = computed(() => {
    const f = this.filter();
    return [this.typeSel().length, f.from, f.to, f.accountId, f.categoryId, f.paymentMethod, f.min, f.max, f.hasAttachment].filter(Boolean).length;
  });

  protected readonly result = load(
    () => ({ f: this.filter(), n: this.limit(), rev: this.repo.rev() }),
    ({ f, n }) => this.repo.query(f, 0, n),
    { items: [], total: 0 },
  );

  protected search(v: string) {
    this.qInput.set(v);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.q.set(v);
      this.limit.set(PAGE);
    }, 250);
  }

  protected toggleType(t: TxType) {
    this.typeSel.update((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  }

  protected reset() {
    for (const s of [this.from, this.to, this.accountId, this.categoryId, this.paymentMethod, this.min, this.max]) s.set('');
    this.typeSel.set([]);
    this.hasAttachment.set(false);
    this.sort.set('date');
    this.asc.set(false);
  }
}
