import Dexie, { Table, Transaction } from 'dexie';
import { Account, Attachment, AttachmentBlob, Category, Setting, Tx } from './models';

/**
 * IndexedDB schema. Migration strategy: never edit an existing version. To change the schema,
 * add `this.version(N + 1).stores({...changed tables}).upgrade(tx => ...)` below; Dexie runs
 * every pending upgrade in order inside one versionchange transaction.
 */
export class AppDB extends Dexie {
  transactions!: Table<Tx, string>;
  accounts!: Table<Account, string>;
  categories!: Table<Category, string>;
  /** Attachment metadata, kept apart from the blobs so lists never load file bytes. */
  attachments!: Table<Attachment, string>;
  blobs!: Table<AttachmentBlob, string>;
  settings!: Table<Setting, string>;

  constructor(name = 'expense-tracker') {
    super(name);
    this.version(1).stores({
      transactions: 'id, type, date, accountId, toAccountId, categoryId, loanId, updatedAt, [type+date]',
      accounts: 'id, order',
      categories: 'id, kind, order',
      attachments: 'id, txId',
      blobs: 'id',
      settings: 'key',
    });
    this.on('populate', (tx) => seed(tx));
  }
}

export const DEFAULT_ACCOUNTS: Account[] = [
  { id: 'acc-cash', name: 'Cash', bankName: 'Cash', kind: 'cash' },
  { id: 'acc-soneri', name: 'Soneri Bank', bankName: 'Soneri Bank', kind: 'current' },
  { id: 'acc-mcb', name: 'MCB Bank', bankName: 'MCB Bank', kind: 'current' },
  { id: 'acc-scb', name: 'Standard Chartered', bankName: 'Standard Chartered Bank', kind: 'current' },
  { id: 'acc-other-bank', name: 'Other bank', bankName: 'Other bank', kind: 'other' },
  { id: 'acc-other', name: 'Other payment method', bankName: 'Other', kind: 'other' },
].map((a, i) => ({ ...(a as Account), active: true, order: i }));

const EXPENSE_CATS = [
  'Food and groceries',
  'Restaurants and takeaway',
  'Transport and fuel',
  'Rent and housing',
  'Utilities and bills',
  'Shopping and clothing',
  'Healthcare and medicines',
  'Education',
  'Travel',
  'Subscriptions',
  'Family and personal',
  'Business expenses',
  'Other',
];
const INCOME_CATS = ['Salary', 'Freelance income', 'Business income', 'Refunds', 'Gifts', 'Investment income', 'Other'];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '-');
export const DEFAULT_CATEGORIES: Category[] = [
  ...EXPENSE_CATS.map((name, order) => ({ id: `exp-${slug(name)}`, name, kind: 'expense' as const, order })),
  ...INCOME_CATS.map((name, order) => ({ id: `inc-${slug(name)}`, name, kind: 'income' as const, order })),
];
/** Fallback categories that deleted categories are reassigned to. */
export const OTHER_CATEGORY = { expense: 'exp-other', income: 'inc-other' } as const;

function seed(tx: Transaction) {
  tx.table('accounts').bulkAdd(DEFAULT_ACCOUNTS);
  tx.table('categories').bulkAdd(DEFAULT_CATEGORIES);
  tx.table('settings').bulkAdd([{ key: 'currency', value: { symbol: 'Rs.', code: 'PKR' } }]);
}
