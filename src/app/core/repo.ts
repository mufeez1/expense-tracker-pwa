import { Injectable, signal } from '@angular/core';
import { AppDB, OTHER_CATEGORY } from './db';
import { assertRepaymentFits } from './finance';
import { Account, AppError, Attachment, Category, PaymentMethod, Tx, TxType } from './models';
import { validateAccount, validateCategory, validateTx } from './validate';

export interface NewAttachment {
  meta: Omit<Attachment, 'txId'>;
  blob: Blob;
}

export interface TxFilter {
  types?: TxType[];
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  paymentMethod?: PaymentMethod;
  min?: number;
  max?: number;
  q?: string;
  hasAttachment?: boolean;
  sort?: 'date' | 'amount' | 'title' | 'updated';
  asc?: boolean;
}

/** Data-access layer. Components never touch Dexie directly. */
@Injectable({ providedIn: 'root', useFactory: () => new Repo(new AppDB()) })
export class Repo {
  /** Bumped after every write so signal-driven queries reload. */
  readonly rev = signal(0);

  constructor(readonly db: AppDB) {}

  private bump() {
    this.rev.update((v) => v + 1);
  }

  // ---- transactions ----

  getTx(id: string) {
    return this.db.transactions.get(id);
  }

  /** Inclusive local-date range, used for dashboards and reports. */
  range(from: string, to: string): Promise<Tx[]> {
    return this.db.transactions.where('date').between(from, to, true, true).toArray();
  }

  /** All lend/borrow records plus their repayments. */
  loanRecords(): Promise<Tx[]> {
    return this.db.transactions.where('type').anyOf('lend', 'borrow', 'repayment').toArray();
  }

  /** Every record that moves money in or out of an account. */
  async accountTxs(accountId: string): Promise<Tx[]> {
    const t = this.db.transactions;
    const [a, b] = await Promise.all([t.where('accountId').equals(accountId).toArray(), t.where('toAccountId').equals(accountId).toArray()]);
    return [...a, ...b];
  }

  repaymentsOf(loanId: string): Promise<Tx[]> {
    return this.db.transactions.where('loanId').equals(loanId).toArray();
  }

  /**
   * Creates or updates a transaction together with its attachment changes in a single IndexedDB
   * transaction, so a failed write (e.g. quota exceeded) leaves nothing half-saved.
   */
  async saveTx(input: Tx, add: NewAttachment[] = [], removeIds: string[] = []): Promise<Tx> {
    const now = Date.now();
    const { db } = this;
    let saved!: Tx;
    await db.transaction('rw', db.transactions, db.attachments, db.blobs, async () => {
      const existing = await db.transactions.get(input.id);
      if (existing && existing.type !== input.type) throw new AppError('The type of a saved record cannot change.');

      if (input.type === 'repayment') {
        const loan = input.loanId ? await db.transactions.get(input.loanId) : undefined;
        if (!loan || (loan.type !== 'lend' && loan.type !== 'borrow')) throw new AppError('Choose the loan this repayment belongs to.');
        const others = (await db.transactions.where('loanId').equals(loan.id).toArray()).filter((r) => r.id !== input.id);
        assertRepaymentFits(loan, others, input.amount);
      }
      if (existing && (input.type === 'lend' || input.type === 'borrow')) {
        const repaid = (await db.transactions.where('loanId').equals(input.id).toArray()).reduce((s, r) => s + r.amount, 0);
        if (input.amount < repaid) throw new AppError('The loan amount cannot be less than what has already been repaid.');
      }

      if (removeIds.length) {
        const owned = (await db.attachments.bulkGet(removeIds)).filter((a) => a?.txId === input.id).map((a) => a!.id);
        await db.attachments.bulkDelete(owned);
        await db.blobs.bulkDelete(owned);
      }
      if (add.length) {
        await db.attachments.bulkAdd(add.map((a) => ({ ...a.meta, txId: input.id })));
        await db.blobs.bulkAdd(add.map((a) => ({ id: a.meta.id, blob: a.blob })));
      }
      const attachmentCount = await db.attachments.where('txId').equals(input.id).count();
      saved = { ...input, attachmentCount, createdAt: existing?.createdAt ?? now, updatedAt: now };
      const err = validateTx(saved);
      if (err) throw new AppError(`Invalid record: ${err}.`);
      await db.transactions.put(saved);
    });
    this.bump();
    return saved;
  }

  /** Deletes a record, its attachments and — for loans — every linked repayment. */
  async deleteTx(id: string): Promise<void> {
    const { db } = this;
    await db.transaction('rw', db.transactions, db.attachments, db.blobs, async () => {
      const ids = [id, ...(await db.transactions.where('loanId').equals(id).primaryKeys())];
      const attIds = await db.attachments.where('txId').anyOf(ids).primaryKeys();
      await db.attachments.bulkDelete(attIds);
      await db.blobs.bulkDelete(attIds);
      await db.transactions.bulkDelete(ids);
    });
    this.bump();
  }

  /** Filtered, paginated query. Date sort streams from the date index; other sorts sort the filtered set. */
  async query(f: TxFilter, offset: number, limit: number): Promise<{ items: Tx[]; total: number }> {
    const t = this.db.transactions;
    const from = f.from || '0000-00-00';
    const to = f.to || '9999-99-99';
    const single = f.types?.length === 1 ? f.types[0] : undefined;
    const base = () =>
      single
        ? t.where('[type+date]').between([single, from], [single, to], true, true)
        : t.where('date').between(from, to, true, true);

    const q = f.q?.trim().toLowerCase();
    const pred = (x: Tx) =>
      (!f.types?.length || f.types.includes(x.type)) &&
      (!f.accountId || x.accountId === f.accountId || x.toAccountId === f.accountId) &&
      (!f.categoryId || x.categoryId === f.categoryId) &&
      (!f.paymentMethod || x.paymentMethod === f.paymentMethod) &&
      (f.min === undefined || x.amount >= f.min) &&
      (f.max === undefined || x.amount <= f.max) &&
      (!f.hasAttachment || x.attachmentCount > 0) &&
      (!q || [x.title, x.counterparty, x.reference, x.notes, ...x.tags].some((s) => s?.toLowerCase().includes(q)));

    const sort = f.sort ?? 'date';
    if (sort === 'date') {
      const coll = () => (f.asc ? base() : base().reverse()).filter(pred);
      const [items, total] = await Promise.all([coll().offset(offset).limit(limit).toArray(), coll().count()]);
      return { items, total };
    }
    // ponytail: non-date sorts load the filtered set into memory; fine for tens of thousands of rows.
    const key = { amount: 'amount', title: 'title', updated: 'updatedAt' }[sort] as keyof Tx;
    let all = await base().filter(pred).sortBy(key);
    if (!f.asc) all = all.reverse();
    return { items: all.slice(offset, offset + limit), total: all.length };
  }

  // ---- attachments ----

  attachmentsOf(txId: string): Promise<Attachment[]> {
    return this.db.attachments.where('txId').equals(txId).toArray();
  }

  async blob(id: string): Promise<Blob | undefined> {
    return (await this.db.blobs.get(id))?.blob;
  }

  // ---- accounts & categories ----

  accounts(): Promise<Account[]> {
    return this.db.accounts.orderBy('order').toArray();
  }

  async saveAccount(a: Account): Promise<void> {
    const err = validateAccount(a);
    if (err) throw new AppError(`Invalid account: ${err}.`);
    await this.db.accounts.put(a);
    this.bump();
  }

  async deleteAccount(id: string): Promise<void> {
    const t = this.db.transactions;
    const used = (await t.where('accountId').equals(id).count()) + (await t.where('toAccountId').equals(id).count());
    if (used) throw new AppError(`This account is used by ${used} record(s). Deactivate it instead.`);
    await this.db.accounts.delete(id);
    this.bump();
  }

  categories(): Promise<Category[]> {
    return this.db.categories.orderBy('order').toArray();
  }

  async saveCategory(c: Category): Promise<void> {
    const err = validateCategory(c);
    if (err) throw new AppError(`Invalid category: ${err}.`);
    await this.db.categories.put(c);
    this.bump();
  }

  async saveCategoryOrder(cats: Category[]): Promise<void> {
    await this.db.categories.bulkPut(cats.map((c, order) => ({ ...c, order })));
    this.bump();
  }

  /** Deletes a category and moves its records to "Other". */
  async deleteCategory(id: string): Promise<void> {
    const { db } = this;
    await db.transaction('rw', db.categories, db.transactions, async () => {
      const cat = await db.categories.get(id);
      if (!cat) return;
      const other = OTHER_CATEGORY[cat.kind];
      if (id === other) throw new AppError('The "Other" category is used as a fallback and cannot be deleted.');
      await db.transactions.where('categoryId').equals(id).modify({ categoryId: other, updatedAt: Date.now() });
      await db.categories.delete(id);
    });
    this.bump();
  }

  // ---- settings & stats ----

  async setting<T>(key: string, fallback: T): Promise<T> {
    return ((await this.db.settings.get(key))?.value as T) ?? fallback;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.settings.put({ key, value });
    this.bump();
  }

  async counts() {
    const { db } = this;
    const [transactions, attachments, accounts, categories, blobs] = await Promise.all([
      db.transactions.count(),
      db.attachments.count(),
      db.accounts.count(),
      db.categories.count(),
      db.blobs.count(),
    ]);
    let attachmentBytes = 0;
    await db.attachments.each((a) => (attachmentBytes += a.size));
    return { transactions, attachments, accounts, categories, blobs, attachmentBytes };
  }

  /** Called after a backup restore so every view reloads. */
  changed() {
    this.bump();
  }
}
