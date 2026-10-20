import { Account, AppError, Tx, TxType } from './models';
import { formatMoney } from './money';

// Accounting rules:
// - Only `expense` and `income` count towards cash-flow totals.
// - Lending creates a receivable, borrowing a liability; principal repayments only move those balances.
// - Transfers move money between own accounts and never count as income/expense.

export interface Totals {
  expense: number;
  income: number;
  net: number;
  count: number;
}

export function totals(txs: Tx[]): Totals {
  let expense = 0;
  let income = 0;
  let count = 0;
  for (const t of txs) {
    if (t.type === 'expense') (expense += t.amount), count++;
    else if (t.type === 'income') (income += t.amount), count++;
  }
  return { expense, income, net: income - expense, count };
}

export interface Group {
  key: string;
  total: number;
  count: number;
  /** Share of the grand total, 0..100. */
  pct: number;
}

export function groupBy(txs: Tx[], type: 'expense' | 'income', key: (t: Tx) => string): Group[] {
  const map = new Map<string, Group>();
  let grand = 0;
  for (const t of txs) {
    if (t.type !== type) continue;
    const k = key(t);
    const g = map.get(k) ?? { key: k, total: 0, count: 0, pct: 0 };
    g.total += t.amount;
    g.count++;
    grand += t.amount;
    map.set(k, g);
  }
  const groups = [...map.values()].sort((a, b) => b.total - a.total);
  for (const g of groups) g.pct = grand ? (g.total / grand) * 100 : 0;
  return groups;
}

export type LoanStatus = 'outstanding' | 'partial' | 'repaid' | 'overdue';
export const LOAN_STATUS_LABEL: Record<LoanStatus, string> = {
  outstanding: 'Outstanding',
  partial: 'Partially repaid',
  repaid: 'Repaid',
  overdue: 'Overdue',
};

export function loanStatus(amount: number, repaid: number, dueDate: string | undefined, today: string): LoanStatus {
  if (repaid >= amount) return 'repaid';
  if (dueDate && dueDate < today) return 'overdue';
  return repaid > 0 ? 'partial' : 'outstanding';
}

export interface LoanView {
  loan: Tx;
  repayments: Tx[];
  repaid: number;
  remaining: number;
  status: LoanStatus;
}

/** Builds loan balances from lend/borrow records and their linked repayment records. */
export function loanViews(txs: Tx[], today: string): LoanView[] {
  const views = new Map<string, LoanView>();
  for (const t of txs) {
    if (t.type === 'lend' || t.type === 'borrow') views.set(t.id, { loan: t, repayments: [], repaid: 0, remaining: 0, status: 'outstanding' });
  }
  for (const t of txs) {
    const v = t.type === 'repayment' && t.loanId ? views.get(t.loanId) : undefined;
    if (v) v.repayments.push(t), (v.repaid += t.amount);
  }
  for (const v of views.values()) {
    v.repayments.sort((a, b) => a.date.localeCompare(b.date));
    v.remaining = Math.max(0, v.loan.amount - v.repaid);
    v.status = loanStatus(v.loan.amount, v.repaid, v.loan.dueDate, today);
  }
  return [...views.values()].sort((a, b) => b.loan.date.localeCompare(a.loan.date));
}

export interface LoanTotals {
  lent: number;
  returnedToMe: number;
  owedToMe: number;
  overdueToMe: number;
  borrowed: number;
  repaidByMe: number;
  iOwe: number;
  overdueByMe: number;
}

export function loanTotals(views: LoanView[]): LoanTotals {
  const t: LoanTotals = { lent: 0, returnedToMe: 0, owedToMe: 0, overdueToMe: 0, borrowed: 0, repaidByMe: 0, iOwe: 0, overdueByMe: 0 };
  for (const v of views) {
    const overdue = v.status === 'overdue' ? v.remaining : 0;
    if (v.loan.type === 'lend') {
      t.lent += v.loan.amount;
      t.returnedToMe += v.repaid;
      t.owedToMe += v.remaining;
      t.overdueToMe += overdue;
    } else {
      t.borrowed += v.loan.amount;
      t.repaidByMe += v.repaid;
      t.iOwe += v.remaining;
      t.overdueByMe += overdue;
    }
  }
  return t;
}

/** Net movement of lending/borrowing inside a period (principal out minus repayments back). */
export function periodLoanFlow(txsInPeriod: Tx[], loanType: (loanId: string) => TxType | undefined) {
  let lending = 0;
  let borrowing = 0;
  for (const t of txsInPeriod) {
    if (t.type === 'lend') lending += t.amount;
    else if (t.type === 'borrow') borrowing += t.amount;
    else if (t.type === 'repayment' && t.loanId) {
      if (loanType(t.loanId) === 'lend') lending -= t.amount;
      else borrowing -= t.amount;
    }
  }
  return { lending, borrowing };
}

/** Throws if a repayment would exceed what is still owed on the loan. */
export function assertRepaymentFits(loan: Tx, otherRepayments: Tx[], amount: number): void {
  const repaid = otherRepayments.reduce((s, r) => s + r.amount, 0);
  const remaining = loan.amount - repaid;
  if (amount > remaining) {
    throw new AppError(`Repayment exceeds the remaining balance of ${formatMoney(Math.max(0, remaining))}.`);
  }
}

/** Effect of one transaction on one account's balance. */
export function balanceEffect(t: Tx, accountId: string, loanType: (loanId: string) => TxType | undefined): number {
  if (t.type === 'transfer') {
    return (t.toAccountId === accountId ? t.amount : 0) - (t.accountId === accountId ? t.amount : 0);
  }
  if (t.accountId !== accountId) return 0;
  switch (t.type) {
    case 'income':
    case 'borrow':
      return t.amount;
    case 'expense':
    case 'lend':
      return -t.amount;
    case 'repayment':
      return t.loanId && loanType(t.loanId) === 'lend' ? t.amount : -t.amount;
  }
}

/**
 * Balance is only known when the user recorded an opening balance; everything on or after the
 * opening date is applied to it. Returns null otherwise.
 */
export function accountBalance(account: Account, txs: Tx[], loanType: (loanId: string) => TxType | undefined): number | null {
  if (account.openingBalance === undefined) return null;
  const from = account.openingDate ?? '0000-00-00';
  let bal = account.openingBalance;
  for (const t of txs) if (t.date >= from) bal += balanceEffect(t, account.id, loanType);
  return bal;
}
