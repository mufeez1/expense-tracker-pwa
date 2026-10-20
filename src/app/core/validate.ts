import { isDate } from './dates';
import { ACCOUNT_KINDS, PAYMENT_METHODS, TX_TYPES } from './models';

// Shared by the repository (every write) and backup import (untrusted files).

export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_AMOUNT = 1e15; // well under Number.MAX_SAFE_INTEGER

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 500) => typeof v === 'string' && v.length <= max;
const optStr = (v: unknown, max = 500) => v === undefined || str(v, max);
const int = (v: unknown, min = 0) => Number.isSafeInteger(v) && (v as number) >= min;

export function validateTx(r: unknown): string | null {
  if (!isObj(r)) return 'not an object';
  if (!str(r['id'], 64) || !r['id']) return 'bad id';
  if (!TX_TYPES.includes(r['type'] as never)) return 'bad type';
  if (!str(r['title'], 200) || !(r['title'] as string).trim()) return 'title required';
  if (!int(r['amount'], 1) || (r['amount'] as number) > MAX_AMOUNT) return 'amount must be a positive whole number of minor units';
  if (!isDate(r['date'])) return 'bad date';
  if (r['time'] !== undefined && !(typeof r['time'] === 'string' && /^\d{2}:\d{2}$/.test(r['time']))) return 'bad time';
  if (r['dueDate'] !== undefined && !isDate(r['dueDate'])) return 'bad due date';
  if (r['paymentMethod'] !== undefined && !PAYMENT_METHODS.some((p) => p.id === r['paymentMethod'])) return 'bad payment method';
  for (const k of ['categoryId', 'accountId', 'toAccountId', 'loanId']) if (!optStr(r[k], 64)) return `bad ${k}`;
  for (const k of ['subcategory', 'counterparty', 'reference', 'contact']) if (!optStr(r[k], 200)) return `bad ${k}`;
  if (!optStr(r['notes'], 5000)) return 'notes too long';
  if (!Array.isArray(r['tags']) || r['tags'].length > 50 || !r['tags'].every((t) => str(t, 50))) return 'bad tags';
  if (!int(r['attachmentCount']) || !int(r['createdAt']) || !int(r['updatedAt'])) return 'bad counters/timestamps';
  if (r['type'] === 'repayment' && !r['loanId']) return 'repayment needs a loan';
  if (r['type'] === 'transfer') {
    if (!r['accountId'] || !r['toAccountId']) return 'transfer needs both accounts';
    if (r['accountId'] === r['toAccountId']) return 'transfer accounts must differ';
  }
  if ((r['type'] === 'lend' || r['type'] === 'borrow') && !str(r['counterparty'], 200)) return 'loan needs a person';
  return null;
}

export function validateAccount(r: unknown): string | null {
  if (!isObj(r)) return 'not an object';
  if (!str(r['id'], 64) || !str(r['name'], 100) || !(r['name'] as string).trim()) return 'bad id/name';
  if (!str(r['bankName'], 100)) return 'bad bank name';
  if (!ACCOUNT_KINDS.some((k) => k.id === r['kind'])) return 'bad kind';
  if (!optStr(r['nickname'], 100)) return 'bad nickname';
  if (r['last4'] !== undefined && !(typeof r['last4'] === 'string' && /^\d{4}$/.test(r['last4']))) return 'last 4 must be 4 digits';
  if (r['openingBalance'] !== undefined && !(Number.isSafeInteger(r['openingBalance']))) return 'bad opening balance';
  if (r['openingDate'] !== undefined && !isDate(r['openingDate'])) return 'bad opening date';
  if (typeof r['active'] !== 'boolean' || !int(r['order'])) return 'bad flags';
  return null;
}

export function validateCategory(r: unknown): string | null {
  if (!isObj(r)) return 'not an object';
  if (!str(r['id'], 64) || !str(r['name'], 100) || !(r['name'] as string).trim()) return 'bad id/name';
  if (r['kind'] !== 'expense' && r['kind'] !== 'income') return 'bad kind';
  if (!int(r['order'])) return 'bad order';
  return null;
}

export function validateAttachment(r: unknown): string | null {
  if (!isObj(r)) return 'not an object';
  if (!str(r['id'], 64) || !str(r['txId'], 64) || !str(r['name'], 200)) return 'bad id/name';
  if (!ALLOWED_MIME.includes(r['type'] as string)) return 'unsupported file type';
  if (!int(r['size']) || !int(r['createdAt'])) return 'bad size/date';
  return null;
}

/** Strip path separators and control characters from user/imported filenames. */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').trim().slice(0, 120);
  return cleaned || 'file';
}
