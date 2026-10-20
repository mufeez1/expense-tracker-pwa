// Generates an importable demo backup: node scripts/demo-data.mjs [count=600] [out=demo-backup.zip]
// Import it via Backup & restore. Use a large count (e.g. 10000) to benchmark.
import { strToU8, zipSync } from 'fflate';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const count = Number(process.argv[2] ?? 600);
const out = process.argv[3] ?? 'demo-backup.zip';
const accounts = ['acc-cash', 'acc-soneri', 'acc-mcb', 'acc-scb'];
const exp = [
  ['exp-food-and-groceries', 'Groceries', 'Imtiaz', 2000, 15000],
  ['exp-restaurants-and-takeaway', 'Dinner', 'Kolachi', 1500, 9000],
  ['exp-transport-and-fuel', 'Fuel', 'PSO', 3000, 12000],
  ['exp-utilities-and-bills', 'Electricity bill', 'K-Electric', 6000, 25000],
  ['exp-shopping-and-clothing', 'Online purchase', 'Daraz', 1500, 20000],
  ['exp-healthcare-and-medicines', 'Medicines', 'Pharmacy', 500, 6000],
  ['exp-subscriptions', 'Internet', 'Nayatel', 3500, 3500],
];
const rnd = (a, b) => Math.round(a + Math.random() * (b - a));
const pick = (l) => l[Math.floor(Math.random() * l.length)];
const now = Date.now();
const day = (back) => new Date(now - back * 86400000).toISOString().slice(0, 10);
const base = { tags: [], attachmentCount: 0, createdAt: now, updatedAt: now };
const span = Math.max(180, Math.round(count / 6)); // days of history

const txs = [];
for (let i = 0; i < count; i++) {
  const [categoryId, title, counterparty, lo, hi] = pick(exp);
  txs.push({ ...base, id: randomUUID(), type: 'expense', title, counterparty, categoryId, amount: rnd(lo, hi) * 100, date: day(rnd(0, span)), accountId: pick(accounts), paymentMethod: pick(['cash', 'debit_card', 'bank_transfer']) });
}
for (let m = 0; m * 30 < span; m++) {
  txs.push({ ...base, id: randomUUID(), type: 'income', title: 'Salary', categoryId: 'inc-salary', amount: 25000000, date: day(m * 30 + 2), accountId: 'acc-mcb', paymentMethod: 'bank_transfer' });
}
const lend = { ...base, id: randomUUID(), type: 'lend', title: 'Lent to Ahmed', counterparty: 'Ahmed', amount: 2000000, date: day(40), dueDate: day(5), accountId: 'acc-mcb' };
const borrow = { ...base, id: randomUUID(), type: 'borrow', title: 'Borrowed from Sara', counterparty: 'Sara', amount: 5000000, date: day(60), dueDate: day(-20), accountId: 'acc-soneri' };
txs.push(lend, borrow,
  { ...base, id: randomUUID(), type: 'repayment', title: 'Repayment from Ahmed', counterparty: 'Ahmed', loanId: lend.id, amount: 500000, date: day(20), accountId: 'acc-mcb' },
  { ...base, id: randomUUID(), type: 'repayment', title: 'Repayment to Sara', counterparty: 'Sara', loanId: borrow.id, amount: 2000000, date: day(10), accountId: 'acc-soneri' },
  { ...base, id: randomUUID(), type: 'transfer', title: 'MCB Bank → Soneri Bank', amount: 3000000, date: day(15), accountId: 'acc-mcb', toAccountId: 'acc-soneri' });

const manifest = { app: 'expense-tracker', format: 1, exportedAt: new Date().toISOString(), data: { transactions: txs, accounts: [], categories: [], attachments: [], settings: [] } };
writeFileSync(out, zipSync({ 'backup.json': strToU8(JSON.stringify(manifest)) }));
console.log(`Wrote ${txs.length} records to ${out}`);
