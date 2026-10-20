export type TxType = 'expense' | 'income' | 'lend' | 'borrow' | 'repayment' | 'transfer';
export const TX_TYPES: TxType[] = ['expense', 'income', 'lend', 'borrow', 'repayment', 'transfer'];

export const TX_LABEL: Record<TxType, string> = {
  expense: 'Expense',
  income: 'Income',
  lend: 'Lent',
  borrow: 'Borrowed',
  repayment: 'Repayment',
  transfer: 'Transfer',
};

export type PaymentMethod =
  | 'cash'
  | 'debit_card'
  | 'credit_card'
  | 'bank_transfer'
  | 'mobile_wallet'
  | 'cheque'
  | 'other';

export const PAYMENT_METHODS: { id: PaymentMethod; name: string }[] = [
  { id: 'cash', name: 'Cash' },
  { id: 'debit_card', name: 'Debit card' },
  { id: 'credit_card', name: 'Credit card' },
  { id: 'bank_transfer', name: 'Bank transfer' },
  { id: 'mobile_wallet', name: 'Mobile wallet' },
  { id: 'cheque', name: 'Cheque' },
  { id: 'other', name: 'Other' },
];

/** All money values are integer minor units (paisa for PKR). */
export interface Tx {
  id: string;
  type: TxType;
  title: string;
  amount: number;
  /** Local calendar date YYYY-MM-DD (no timezone conversion). */
  date: string;
  time?: string;
  categoryId?: string;
  subcategory?: string;
  /** Account used; for transfers, the source account. */
  accountId?: string;
  /** Transfers only: destination account. */
  toAccountId?: string;
  paymentMethod?: PaymentMethod;
  /** Merchant, payer or person, depending on type. */
  counterparty?: string;
  reference?: string;
  notes?: string;
  tags: string[];
  /** Repayments only: the lend/borrow record being repaid. */
  loanId?: string;
  dueDate?: string;
  contact?: string;
  attachmentCount: number;
  createdAt: number;
  updatedAt: number;
}

export type AccountKind = 'cash' | 'current' | 'savings' | 'credit_card' | 'wallet' | 'other';
export const ACCOUNT_KINDS: { id: AccountKind; name: string }[] = [
  { id: 'cash', name: 'Cash' },
  { id: 'current', name: 'Current account' },
  { id: 'savings', name: 'Savings account' },
  { id: 'credit_card', name: 'Credit card' },
  { id: 'wallet', name: 'Mobile wallet' },
  { id: 'other', name: 'Other' },
];

export interface Account {
  id: string;
  name: string;
  bankName: string;
  kind: AccountKind;
  nickname?: string;
  last4?: string;
  openingBalance?: number;
  openingDate?: string;
  active: boolean;
  order: number;
}

export interface Category {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  order: number;
}

export interface Attachment {
  id: string;
  txId: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
}

export interface AttachmentBlob {
  id: string;
  blob: Blob;
}

export interface Setting {
  key: string;
  value: unknown;
}

/** Errors whose message is safe and useful to show the user. */
export class AppError extends Error {
  override name = 'AppError';
}

export function uid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID is unavailable on plain-http LAN origins; fall back to getRandomValues.
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
