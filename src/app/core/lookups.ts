import { computed, effect, inject, Injectable } from '@angular/core';
import { Account, Category } from './models';
import { setCurrencySymbol } from './money';
import { Repo } from './repo';
import { load } from './ui';

export interface Currency {
  symbol: string;
  code: string;
}

/** Accounts, categories and currency, kept in sync with the database. */
@Injectable({ providedIn: 'root' })
export class Lookups {
  private repo = inject(Repo);
  readonly accounts = load(() => this.repo.rev(), () => this.repo.accounts(), [] as Account[]);
  readonly activeAccounts = computed(() => this.accounts().filter((a) => a.active));
  readonly categories = load(() => this.repo.rev(), () => this.repo.categories(), [] as Category[]);
  readonly expenseCats = computed(() => this.categories().filter((c) => c.kind === 'expense'));
  readonly incomeCats = computed(() => this.categories().filter((c) => c.kind === 'income'));
  readonly accName = computed(() => new Map(this.accounts().map((a) => [a.id, a.name])));
  readonly catName = computed(() => new Map(this.categories().map((c) => [c.id, c.name])));
  readonly currency = load(() => this.repo.rev(), () => this.repo.setting<Currency>('currency', { symbol: 'Rs.', code: 'PKR' }), {
    symbol: 'Rs.',
    code: 'PKR',
  });

  constructor() {
    effect(() => setCurrencySymbol(this.currency().symbol));
  }
}
