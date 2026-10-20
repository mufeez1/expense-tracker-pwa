import { strFromU8, strToU8, unzipSync, zipSync, Zippable } from 'fflate';
import { AppDB, DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES } from './db';
import { loanViews } from './finance';
import { Account, AppError, Attachment, Category, Setting, Tx } from './models';
import { validateAccount, validateAttachment, validateCategory, validateTx } from './validate';

export const BACKUP_FORMAT = 1;
const APP_ID = 'expense-tracker';

export interface BackupData {
  transactions: Tx[];
  accounts: Account[];
  categories: Category[];
  attachments: Attachment[];
  settings: Setting[];
}

interface Manifest {
  app: string;
  format: number;
  exportedAt: string;
  data: BackupData;
}

export interface ParsedBackup {
  exportedAt: string;
  data: BackupData;
  files: Map<string, Uint8Array>;
  counts: Record<keyof BackupData, number>;
  /** Incoming transaction ids that already exist locally. */
  duplicates: number;
  /** Duplicates whose content differs from the local copy. */
  conflicts: number;
}

export type ImportMode = 'merge' | 'replace';

/** Exports every table plus attachment bytes as a ZIP: backup.json + attachments/<id>. */
export async function exportBackup(db: AppDB): Promise<Blob> {
  const [transactions, accounts, categories, attachments, settings, blobs] = await db.transaction(
    'r',
    [db.transactions, db.accounts, db.categories, db.attachments, db.settings, db.blobs],
    () =>
      Promise.all([
        db.transactions.toArray(),
        db.accounts.toArray(),
        db.categories.toArray(),
        db.attachments.toArray(),
        db.settings.toArray(),
        db.blobs.toArray(),
      ]),
  );
  const manifest: Manifest = {
    app: APP_ID,
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    data: { transactions, accounts, categories, attachments, settings },
  };
  const files: Zippable = { 'backup.json': [strToU8(JSON.stringify(manifest)), { level: 6 }] };
  // ponytail: builds the whole archive in memory; stream with fflate's Zip class if backups outgrow device RAM.
  for (const b of blobs) files[`attachments/${b.id}`] = [new Uint8Array(await b.blob.arrayBuffer()), { level: 0 }];
  return new Blob([zipSync(files)], { type: 'application/zip' });
}

/** Parses and validates a backup without touching the database, and previews what importing would do. */
export async function readBackup(file: Blob, db: AppDB): Promise<ParsedBackup> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new AppError('This file is not a valid backup ZIP.');
  }
  if (!entries['backup.json']) throw new AppError('backup.json is missing from the archive.');
  let m: Manifest;
  try {
    m = JSON.parse(strFromU8(entries['backup.json']));
  } catch {
    throw new AppError('backup.json is not valid JSON.');
  }
  if (m?.app !== APP_ID || typeof m.format !== 'number') throw new AppError('This is not an Expense Tracker backup.');
  if (m.format > BACKUP_FORMAT) throw new AppError(`Backup format ${m.format} is newer than this app supports. Update the app first.`);

  const d = m.data ?? ({} as BackupData);
  for (const k of ['transactions', 'accounts', 'categories', 'attachments', 'settings'] as const) {
    if (!Array.isArray(d[k])) throw new AppError(`Backup is missing "${k}".`);
  }
  const check = <T>(list: T[], fn: (r: unknown) => string | null, label: string) =>
    list.forEach((r, i) => {
      const err = fn(r);
      if (err) throw new AppError(`Backup ${label} #${i + 1} is invalid: ${err}.`);
    });
  check(d.transactions, validateTx, 'transaction');
  check(d.accounts, validateAccount, 'account');
  check(d.categories, validateCategory, 'category');
  check(d.attachments, validateAttachment, 'attachment');
  d.settings = d.settings.filter(isKnownSetting);

  const txIds = new Set(d.transactions.map((t) => t.id));
  if (txIds.size !== d.transactions.length) throw new AppError('Backup contains duplicate transaction ids.');
  const files = new Map<string, Uint8Array>();
  for (const a of d.attachments) {
    const bytes = entries[`attachments/${a.id}`];
    if (!bytes) throw new AppError(`Attachment "${a.name}" is missing its file.`);
    if (!txIds.has(a.txId)) throw new AppError(`Attachment "${a.name}" belongs to no transaction.`);
    files.set(a.id, bytes);
  }

  const local = await db.transactions.bulkGet([...txIds]);
  let duplicates = 0;
  let conflicts = 0;
  local.forEach((l, i) => {
    if (!l) return;
    duplicates++;
    if (JSON.stringify(l) !== JSON.stringify(d.transactions[i])) conflicts++;
  });

  return {
    exportedAt: m.exportedAt,
    data: d,
    files,
    counts: {
      transactions: d.transactions.length,
      accounts: d.accounts.length,
      categories: d.categories.length,
      attachments: d.attachments.length,
      settings: d.settings.length,
    },
    duplicates,
    conflicts,
  };
}

function isKnownSetting(s: unknown): s is Setting {
  const v = (s as Setting)?.value as { symbol?: unknown; code?: unknown };
  return (s as Setting)?.key === 'currency' && typeof v?.symbol === 'string' && v.symbol.length <= 8 && typeof v.code === 'string' && v.code.length <= 8;
}

/**
 * Writes a parsed backup inside ONE IndexedDB transaction: if the tab closes or anything fails
 * midway, IndexedDB rolls the whole import back and existing data is untouched.
 * - replace: wipes local data first.
 * - merge: new records are added; for duplicate ids the newer `updatedAt` wins; local accounts,
 *   categories and settings are kept.
 */
export async function applyBackup(
  db: AppDB,
  p: ParsedBackup,
  mode: ImportMode,
  onProgress: (pct: number) => void = () => {},
): Promise<{ added: number; updated: number; skipped: number }> {
  const { data } = p;
  const blobs = data.attachments.map((a) => ({ id: a.id, blob: new Blob([p.files.get(a.id)! as BlobPart], { type: a.type }) }));
  const result = { added: 0, updated: 0, skipped: 0 };
  const tables = [db.transactions, db.accounts, db.categories, db.attachments, db.blobs, db.settings];

  await db.transaction('rw', tables, async () => {
    if (mode === 'replace') {
      await Promise.all(tables.map((t) => t.clear()));
      // A backup without accounts/categories (e.g. generated demo data) falls back to the defaults.
      await db.accounts.bulkAdd(data.accounts.length ? data.accounts : DEFAULT_ACCOUNTS);
      await db.categories.bulkAdd(data.categories.length ? data.categories : DEFAULT_CATEGORIES);
      await db.settings.bulkAdd(data.settings);
    } else {
      await addMissing(db.accounts, data.accounts);
      await addMissing(db.categories, data.categories);
      await addMissing(db.settings, data.settings, 'key');
    }
    onProgress(10);

    const CHUNK = 500;
    const touched: string[] = [];
    for (let i = 0; i < data.transactions.length; i += CHUNK) {
      const chunk = data.transactions.slice(i, i + CHUNK);
      const local = mode === 'merge' ? await db.transactions.bulkGet(chunk.map((t) => t.id)) : [];
      const write = chunk.filter((t, j) => {
        const l = local[j];
        if (!l) return result.added++, true;
        if (t.updatedAt > l.updatedAt) return result.updated++, true;
        return result.skipped++, false;
      });
      await db.transactions.bulkPut(write);
      touched.push(...write.map((t) => t.id));
      onProgress(10 + Math.round(((i + chunk.length) / Math.max(1, data.transactions.length)) * 60));
    }

    for (let i = 0; i < data.attachments.length; i += 50) {
      const metas = data.attachments.slice(i, i + 50);
      const exists = await db.attachments.bulkGet(metas.map((a) => a.id));
      const fresh = metas.filter((_, j) => !exists[j]);
      await db.attachments.bulkAdd(fresh);
      await db.blobs.bulkPut(blobs.slice(i, i + 50).filter((_, j) => !exists[j]));
      touched.push(...fresh.map((a) => a.txId));
      onProgress(70 + Math.round(((i + metas.length) / Math.max(1, data.attachments.length)) * 25));
    }

    // Keep attachment counters consistent with what is actually stored.
    for (const id of new Set(touched)) {
      const n = await db.attachments.where('txId').equals(id).count();
      await db.transactions.update(id, { attachmentCount: n });
    }

    const overpaid = loanViews(await db.transactions.where('type').anyOf('lend', 'borrow', 'repayment').toArray(), '').find(
      (v) => v.repaid > v.loan.amount,
    );
    if (overpaid) throw new AppError(`Import aborted: loan "${overpaid.loan.title}" would be repaid more than its amount.`);
    onProgress(100);
  });
  return result;
}

async function addMissing<T>(table: { bulkGet(keys: string[]): Promise<(T | undefined)[]>; bulkAdd(items: T[]): Promise<unknown> }, items: T[], key = 'id') {
  const existing = await table.bulkGet(items.map((i) => (i as Record<string, string>)[key]));
  await table.bulkAdd(items.filter((_, i) => !existing[i]));
}
