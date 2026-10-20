import { AppDB } from './db';
import { AppError, uid } from './models';
import { Repo } from './repo';
import { mk } from './test-util';
import { friendlyError } from './ui';

const att = (name = 'r.png', type = 'image/png') => ({
  meta: { id: uid(), name, type, size: 3, createdAt: 1 },
  blob: new Blob([new Uint8Array([1, 2, 3])], { type }),
});

describe('Repo', () => {
  let name: string;
  let repo: Repo;
  beforeEach(() => {
    name = `test-${uid()}`;
    repo = new Repo(new AppDB(name));
  });
  afterEach(() => repo.db.delete());

  it('seeds default banks and categories', async () => {
    const accounts = await repo.accounts();
    expect(accounts.map((a) => a.name)).toEqual(['Cash', 'Soneri Bank', 'MCB Bank', 'Standard Chartered', 'Other bank', 'Other payment method']);
    expect((await repo.categories()).filter((c) => c.kind === 'expense')).toHaveLength(13);
  });

  it('adds, edits and deletes an expense, and persists across reopen', async () => {
    const tx = await repo.saveTx(mk({ type: 'expense', amount: 850000, title: 'Groceries', categoryId: 'exp-food-and-groceries', accountId: 'acc-mcb' }));
    expect(tx.createdAt).toBeGreaterThan(0);
    const rev = repo.rev();
    await repo.saveTx({ ...tx, amount: 900000 });
    expect(repo.rev()).toBeGreaterThan(rev);

    repo.db.close();
    const reopened = new Repo(new AppDB(name)); // simulates a page reload
    const back = await reopened.getTx(tx.id);
    expect(back?.amount).toBe(900000);
    expect(back?.createdAt).toBe(tx.createdAt);

    await reopened.deleteTx(tx.id);
    expect(await reopened.getTx(tx.id)).toBeUndefined();
    reopened.db.close();
    repo = new Repo(new AppDB(name));
  });

  it('rejects invalid records', async () => {
    await expect(repo.saveTx(mk({ type: 'expense', amount: 0 }))).rejects.toThrow(AppError);
    await expect(repo.saveTx(mk({ type: 'expense', amount: 1.5 }))).rejects.toThrow(/positive whole number/);
    await expect(repo.saveTx(mk({ type: 'transfer', amount: 100, accountId: 'a', toAccountId: 'a' }))).rejects.toThrow(/must differ/);
  });

  it('records partial and full repayments and blocks overpayment', async () => {
    const loan = await repo.saveTx(mk({ type: 'lend', amount: 2000000, counterparty: 'Ahmed' }));
    await repo.saveTx(mk({ type: 'repayment', amount: 500000, loanId: loan.id }));
    await expect(repo.saveTx(mk({ type: 'repayment', amount: 1500001, loanId: loan.id }))).rejects.toThrow(/exceeds the remaining balance/);
    const last = await repo.saveTx(mk({ type: 'repayment', amount: 1500000, loanId: loan.id }));
    // editing an existing repayment counts everything except itself
    await expect(repo.saveTx({ ...last, amount: 1500000 })).resolves.toBeTruthy();
    await expect(repo.saveTx({ ...last, amount: 1500001 })).rejects.toThrow();
    // a loan can't be reduced below what was already repaid
    await expect(repo.saveTx({ ...loan, amount: 1000000 })).rejects.toThrow(/less than what has already been repaid/);
    expect((await repo.getTx(loan.id))?.amount).toBe(2000000);
  });

  it('deleting a loan removes its repayments and their attachments', async () => {
    const loan = await repo.saveTx(mk({ type: 'borrow', amount: 1000, counterparty: 'Sara' }));
    const r = await repo.saveTx(mk({ type: 'repayment', amount: 400, loanId: loan.id }), [att()]);
    await repo.deleteTx(loan.id);
    expect(await repo.getTx(r.id)).toBeUndefined();
    expect(await repo.db.attachments.count()).toBe(0);
    expect(await repo.db.blobs.count()).toBe(0);
  });

  it('adds and removes attachments with the record', async () => {
    const a1 = att('one.png');
    const a2 = att('two.pdf', 'application/pdf');
    const tx = await repo.saveTx(mk({ type: 'expense', amount: 100 }), [a1, a2]);
    expect(tx.attachmentCount).toBe(2);
    expect((await repo.attachmentsOf(tx.id)).map((a) => a.name).sort()).toEqual(['one.png', 'two.pdf']);
    expect(await repo.blob(a1.meta.id)).toBeTruthy();

    const saved = await repo.saveTx(tx, [], [a1.meta.id]);
    expect(saved.attachmentCount).toBe(1);
    expect(await repo.blob(a1.meta.id)).toBeUndefined();
  });

  it('rolls back the whole save when a write fails', async () => {
    const tx = mk({ type: 'expense', amount: 100 });
    const dup = att();
    await repo.saveTx(mk({ type: 'expense', amount: 1 }), [dup]);
    await expect(repo.saveTx(tx, [att(), dup])).rejects.toBeTruthy(); // duplicate attachment id fails mid-transaction
    expect(await repo.getTx(tx.id)).toBeUndefined();
    expect(await repo.db.attachments.count()).toBe(1);
  });

  it('filters, searches, sorts and paginates', async () => {
    await repo.saveTx(mk({ type: 'expense', amount: 500, title: 'Fuel', date: '2024-01-05', accountId: 'acc-mcb', reference: 'TXN-77' }));
    await repo.saveTx(mk({ type: 'expense', amount: 900, title: 'Groceries', date: '2024-02-10', accountId: 'acc-soneri', categoryId: 'food' }), [att()]);
    await repo.saveTx(mk({ type: 'income', amount: 10000, title: 'Salary', date: '2024-02-01', accountId: 'acc-mcb' }));
    await repo.saveTx(mk({ type: 'transfer', amount: 300, date: '2024-02-15', accountId: 'acc-soneri', toAccountId: 'acc-mcb' }));

    const all = await repo.query({}, 0, 10);
    expect(all.total).toBe(4);
    expect(all.items[0].date).toBe('2024-02-15'); // newest first

    expect((await repo.query({ types: ['expense'] }, 0, 10)).total).toBe(2);
    expect((await repo.query({ accountId: 'acc-mcb' }, 0, 10)).total).toBe(3); // incl. transfer destination
    expect((await repo.query({ categoryId: 'food' }, 0, 10)).items[0].title).toBe('Groceries');
    expect((await repo.query({ q: 'txn-77' }, 0, 10)).items[0].title).toBe('Fuel');
    expect((await repo.query({ from: '2024-02-01', to: '2024-02-10' }, 0, 10)).total).toBe(2);
    expect((await repo.query({ min: 500, max: 900 }, 0, 10)).total).toBe(2);
    expect((await repo.query({ hasAttachment: true }, 0, 10)).total).toBe(1);
    expect((await repo.query({ sort: 'amount' }, 0, 10)).items[0].amount).toBe(10000);
    expect((await repo.query({ sort: 'title', asc: true }, 0, 10)).items[0].title).toBe('Fuel');

    const page2 = await repo.query({}, 2, 2);
    expect(page2.items.map((t) => t.date)).toEqual(['2024-02-01', '2024-01-05']);
    expect(page2.total).toBe(4);
  });

  it('moves records to "Other" when their category is deleted', async () => {
    const tx = await repo.saveTx(mk({ type: 'expense', amount: 1, categoryId: 'exp-travel' }));
    await repo.deleteCategory('exp-travel');
    expect((await repo.getTx(tx.id))?.categoryId).toBe('exp-other');
    await expect(repo.deleteCategory('exp-other')).rejects.toThrow(AppError);
  });

  it('refuses to delete accounts that are in use', async () => {
    await repo.saveTx(mk({ type: 'transfer', amount: 1, accountId: 'acc-cash', toAccountId: 'acc-scb' }));
    await expect(repo.deleteAccount('acc-scb')).rejects.toThrow(/Deactivate/);
    await repo.deleteAccount('acc-other');
    expect((await repo.accounts()).some((a) => a.id === 'acc-other')).toBe(false);
  });

  it('turns quota errors into a clear message', () => {
    expect(friendlyError({ name: 'QuotaExceededError' })).toMatch(/storage is full/i);
    expect(friendlyError({ name: 'AbortError', inner: { name: 'QuotaExceededError' } })).toMatch(/nothing was saved/i);
    expect(friendlyError(new AppError('Specific'))).toBe('Specific');
  });

  it('stays fast with 10,000 transactions', async () => {
    const now = Date.now();
    const rows = Array.from({ length: 10_000 }, (_, i) =>
      mk({ type: i % 5 ? 'expense' : 'income', amount: 100 + i, date: `20${20 + (i % 5)}-${String((i % 12) + 1).padStart(2, '0')}-15`, title: `Item ${i}`, accountId: 'acc-mcb', createdAt: now, updatedAt: now }),
    );
    await repo.db.transactions.bulkAdd(rows);
    let t = performance.now();
    const page = await repo.query({ types: ['expense'], from: '2024-01-01', to: '2024-12-31' }, 0, 50);
    const queryMs = performance.now() - t;
    expect(page.items).toHaveLength(50);
    expect(page.total).toBe(2000);
    t = performance.now();
    const month = await repo.range('2023-06-01', '2023-06-30');
    expect(month.length).toBeGreaterThan(0);
    const rangeMs = performance.now() - t;
    console.info(`10k rows: filtered page ${queryMs.toFixed(0)}ms, month range ${rangeMs.toFixed(0)}ms (fake-indexeddb)`);
    expect(queryMs).toBeLessThan(5000);
  }, 60_000);
});
