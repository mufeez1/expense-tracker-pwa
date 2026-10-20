import { strToU8, unzipSync, zipSync } from 'fflate';
import { applyBackup, exportBackup, readBackup } from './backup';
import { AppDB } from './db';
import { uid } from './models';
import { Repo } from './repo';
import { mk } from './test-util';

const bytes = (b: Blob) => b.arrayBuffer().then((a) => [...new Uint8Array(a)]);

describe('backup', () => {
  let src: Repo;
  let dst: Repo;
  beforeEach(() => {
    src = new Repo(new AppDB(`src-${uid()}`));
    dst = new Repo(new AppDB(`dst-${uid()}`));
  });
  afterEach(async () => {
    await src.db.delete();
    await dst.db.delete();
  });

  async function seed() {
    const loan = await src.saveTx(mk({ type: 'lend', amount: 2000000, counterparty: 'Ahmed' }));
    await src.saveTx(mk({ type: 'repayment', amount: 500000, loanId: loan.id }), [
      { meta: { id: 'att1', name: 'proof.png', type: 'image/png', size: 4, createdAt: 1 }, blob: new Blob([new Uint8Array([9, 8, 7, 6])], { type: 'image/png' }) },
    ]);
    await src.saveTx(mk({ type: 'expense', amount: 850000, title: 'Groceries' }));
    await src.saveAccount({ id: 'acc-x', name: 'My card', bankName: 'MCB', kind: 'credit_card', last4: '1234', active: true, order: 9 });
    return loan;
  }

  it('round-trips records and attachments through a ZIP (replace)', async () => {
    await seed();
    const zip = await exportBackup(src.db);
    const parsed = await readBackup(zip, dst.db);
    expect(parsed.counts).toMatchObject({ transactions: 3, attachments: 1, accounts: 7 });
    expect(parsed.duplicates).toBe(0);

    const r = await applyBackup(dst.db, parsed, 'replace');
    expect(r.added).toBe(3);
    expect(await dst.db.transactions.count()).toBe(3);
    expect(await dst.accounts()).toEqual(await src.accounts());
    expect(await bytes((await dst.blob('att1'))!)).toEqual([9, 8, 7, 6]);
    const rep = (await dst.db.transactions.where('type').equals('repayment').first())!;
    expect(rep.attachmentCount).toBe(1);
  });

  it('merges: detects duplicates, newer copy wins, nothing duplicated', async () => {
    const loan = await seed();
    const zip = await exportBackup(src.db);
    await applyBackup(dst.db, await readBackup(zip, dst.db), 'replace');

    // local edit made after the backup must survive a merge of the older backup
    const local = (await dst.getTx(loan.id))!;
    await new Promise((r) => setTimeout(r, 2));
    await dst.saveTx({ ...local, notes: 'edited locally' });
    await dst.saveTx(mk({ type: 'income', amount: 1 }));

    const parsed = await readBackup(zip, dst.db);
    expect(parsed.duplicates).toBe(3);
    expect(parsed.conflicts).toBe(1);
    const r = await applyBackup(dst.db, parsed, 'merge');
    expect(r).toEqual({ added: 0, updated: 0, skipped: 3 });
    expect(await dst.db.transactions.count()).toBe(4);
    expect((await dst.getTx(loan.id))?.notes).toBe('edited locally');
    expect(await dst.db.attachments.count()).toBe(1);
  });

  it('rejects malformed archives and records', async () => {
    await expect(readBackup(new Blob(['not a zip']), dst.db)).rejects.toThrow(/not a valid backup/);
    const make = (json: unknown) => new Blob([zipSync({ 'backup.json': strToU8(JSON.stringify(json)) }) as BlobPart]);
    await expect(readBackup(make({ app: 'other' }), dst.db)).rejects.toThrow(/not an Expense Tracker backup/);
    await expect(readBackup(make({ app: 'expense-tracker', format: 99, data: {} }), dst.db)).rejects.toThrow(/newer/);
    const data = { transactions: [{ ...mk({ type: 'expense', amount: 1 }), amount: -5 }], accounts: [], categories: [], attachments: [], settings: [] };
    await expect(readBackup(make({ app: 'expense-tracker', format: 1, data }), dst.db)).rejects.toThrow(/transaction #1 is invalid/);
    const missingFile = { ...data, transactions: [mk({ id: 't', type: 'expense', amount: 1 })], attachments: [{ id: 'a', txId: 't', name: 'x.png', type: 'image/png', size: 1, createdAt: 1 }] };
    await expect(readBackup(make({ app: 'expense-tracker', format: 1, data: missingFile }), dst.db)).rejects.toThrow(/missing its file/);
    const badType = { ...missingFile, attachments: [{ ...missingFile.attachments[0], type: 'text/html' }] };
    await expect(readBackup(make({ app: 'expense-tracker', format: 1, data: badType }), dst.db)).rejects.toThrow(/unsupported file type/);
  });

  it('rolls back an import that fails midway, leaving existing data untouched', async () => {
    await seed();
    const existing = await dst.saveTx(mk({ type: 'expense', amount: 42 }));
    // Craft a backup whose repayments exceed the loan; validation passes per-record but the import must abort.
    const zip = await exportBackup(src.db);
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const m = JSON.parse(new TextDecoder().decode(files['backup.json']));
    m.data.transactions.find((t: { type: string }) => t.type === 'repayment').amount = 9_999_999;
    files['backup.json'] = strToU8(JSON.stringify(m));
    const parsed = await readBackup(new Blob([zipSync(files) as BlobPart]), dst.db);

    await expect(applyBackup(dst.db, parsed, 'replace')).rejects.toThrow(/Import aborted/);
    expect(await dst.db.transactions.count()).toBe(1);
    expect((await dst.getTx(existing.id))?.amount).toBe(42);
  });
});
