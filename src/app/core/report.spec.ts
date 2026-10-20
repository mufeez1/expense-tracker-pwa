import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES } from './db';
import { buildReport, pdfSafe, renderPdf, ReportOptions, toCsv } from './report';
import { mk } from './test-util';

const opts: ReportOptions = { from: '2024-03-01', to: '2024-03-31', kind: 'overview', includeLoans: true, redact: false };
const lend = mk({ id: 'L', type: 'lend', amount: 2000000, counterparty: 'Ahmed Khan', date: '2024-03-05', notes: 'private' });
const txs = [
  mk({ type: 'expense', amount: 850000, title: 'Groceries', categoryId: 'exp-food-and-groceries', accountId: 'acc-mcb', date: '2024-03-01', notes: 'weekly' }),
  mk({ type: 'expense', amount: 1200000, title: 'Electricity bill', categoryId: 'exp-utilities-and-bills', accountId: 'acc-soneri', date: '2024-03-31' }),
  mk({ type: 'expense', amount: 450000, title: 'Online purchase', categoryId: 'exp-shopping-and-clothing', accountId: 'acc-scb', date: '2024-03-15' }),
  mk({ type: 'income', amount: 15000000, title: 'Salary', categoryId: 'inc-salary', accountId: 'acc-mcb', date: '2024-03-01' }),
  mk({ type: 'transfer', amount: 3000000, accountId: 'acc-mcb', toAccountId: 'acc-soneri', date: '2024-03-02' }),
  mk({ type: 'expense', amount: 999, date: '2024-04-01' }), // outside range
  lend,
  mk({ type: 'repayment', amount: 500000, loanId: 'L', counterparty: 'Ahmed Khan', date: '2024-03-20' }),
];
const input = {
  txs,
  prevTxs: [mk({ type: 'expense', amount: 2000000, date: '2024-02-10' })],
  loanRecords: txs.filter((t) => ['lend', 'borrow', 'repayment'].includes(t.type)),
  accounts: DEFAULT_ACCOUNTS,
  categories: DEFAULT_CATEGORIES,
  today: '2024-04-02',
};

describe('report', () => {
  it('computes totals from the selected range only, excluding transfers and loans', () => {
    const r = buildReport(input, opts);
    expect(r.totals).toEqual({ expense: 2500000, income: 15000000, net: 12500000, count: 4 });
    expect(r.prevTotals.expense).toBe(2000000);
    expect(r.days).toBe(31);
    expect(r.avgDailySpend).toBe(Math.round(2500000 / 31));
    expect(r.rows).toHaveLength(7); // all record types listed, the April one excluded
    expect(r.rows[0].date).toBe('2024-03-01');
  });

  it('breaks spending down by bank and category', () => {
    const r = buildReport(input, opts);
    expect(r.byAccount.map((g) => [g.key, g.total, g.count])).toEqual([
      ['Soneri Bank', 1200000, 1],
      ['MCB Bank', 850000, 1],
      ['Standard Chartered', 450000, 1],
    ]);
    expect(r.byCategory[0]).toMatchObject({ key: 'Utilities and bills', pct: 48 });
    expect(r.largest[0].title).toBe('Electricity bill');
  });

  it('filters by bank and report type', () => {
    expect(buildReport(input, { ...opts, accountId: 'acc-mcb' }).totals).toMatchObject({ expense: 850000, income: 15000000 });
    const exp = buildReport(input, { ...opts, kind: 'expense' });
    expect(exp.totals.income).toBe(0);
    expect(exp.rows.every((r) => r.type === 'Expense')).toBe(true);
    expect(exp.showLoans).toBe(false);
  });

  it('includes loan balances without double counting repayments', () => {
    const r = buildReport(input, opts);
    expect(r.loans).toHaveLength(1);
    expect(r.loanTotals).toMatchObject({ lent: 2000000, returnedToMe: 500000, owedToMe: 1500000 });
  });

  it('redacts personal details', () => {
    const r = buildReport(input, { ...opts, redact: true });
    const json = JSON.stringify(r);
    expect(json).not.toContain('Ahmed');
    expect(json).not.toContain('weekly');
    expect(json).not.toContain('private');
    expect(r.loans[0].loan.counterparty).toBe('Person 1');
    expect(toCsv(r.rows, 'PKR', true)).not.toMatch(/Notes|Reference/);
  });

  it('renders a multi-page PDF with totals and page numbers', async () => {
    const blob = renderPdf(buildReport(input, opts));
    const text = new TextDecoder('latin1').decode(await blob.arrayBuffer());
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain('Rs. 25,000.00'); // total expenses
    expect(text).toContain('Rs. 150,000.00'); // income
    expect(text).toContain('Spending by bank / account');
    expect(text).toContain('Lending & borrowing');
    expect(text).toMatch(/Page 5 of 5/);
  });

  it('keeps PDF text within the built-in font charset', () => {
    expect(pdfSafe('MCB Bank → Soneri − café “ok”')).toBe('MCB Bank -> Soneri - café "ok"');
    expect(pdfSafe('احمد')).toBe('????');
  });

  it('escapes CSV cells and blocks formula injection', () => {
    const csv = toCsv([{ date: '2024-03-01', type: 'Expense', title: '=HYPERLINK("x")', category: 'a,b', account: '', amount: 2500050, notes: 'line\nbreak', reference: '', counterparty: '' }], 'PKR', false);
    const [head, row] = csv.split('\r\n');
    expect(head).toBe('Date,Type,Title,Category,Account,Amount (PKR),Counterparty,Reference,Notes');
    expect(row).toBe(`2024-03-01,Expense,"'=HYPERLINK(""x"")","a,b",,25000.50,,,"line\nbreak"`);
  });
});
