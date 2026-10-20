import { accountBalance, assertRepaymentFits, groupBy, loanTotals, loanViews, periodLoanFlow, totals } from './finance';
import { Account } from './models';
import { mk } from './test-util';

describe('finance', () => {
  const lend = mk({ id: 'L1', type: 'lend', amount: 2000000, counterparty: 'Ahmed', date: '2024-10-05', accountId: 'mcb' });
  const back = mk({ type: 'repayment', amount: 500000, loanId: 'L1', date: '2024-10-20', accountId: 'mcb' });
  const borrow = mk({ id: 'B1', type: 'borrow', amount: 1000000, counterparty: 'Sara', date: '2024-10-01', dueDate: '2024-10-15', accountId: 'soneri' });
  const txs = [
    mk({ type: 'expense', amount: 850000, categoryId: 'food', accountId: 'mcb' }),
    mk({ type: 'expense', amount: 1200000, categoryId: 'bills', accountId: 'soneri' }),
    mk({ type: 'expense', amount: 450000, categoryId: 'food', accountId: 'scb' }),
    mk({ type: 'income', amount: 15000000, accountId: 'mcb' }),
    mk({ type: 'transfer', amount: 3000000, accountId: 'mcb', toAccountId: 'soneri' }),
    lend,
    back,
    borrow,
  ];

  it('excludes loans, repayments and transfers from income/expense totals', () => {
    expect(totals(txs)).toEqual({ expense: 2500000, income: 15000000, net: 12500000, count: 4 });
  });

  it('groups expenses by bank and category with percentages', () => {
    const byBank = groupBy(txs, 'expense', (t) => t.accountId!);
    expect(byBank.map((g) => [g.key, g.total])).toEqual([['soneri', 1200000], ['mcb', 850000], ['scb', 450000]]);
    expect(byBank.reduce((s, g) => s + g.pct, 0)).toBeCloseTo(100);
    const byCat = groupBy(txs, 'expense', (t) => t.categoryId!);
    expect(byCat[0]).toMatchObject({ key: 'food', total: 1300000, count: 2, pct: 52 });
  });

  it('tracks a partially repaid loan (Ahmed example)', () => {
    const [v] = loanViews([lend, back], '2024-10-25');
    expect(v.loan.amount).toBe(2000000); // original never overwritten
    expect(v.repaid).toBe(500000);
    expect(v.remaining).toBe(1500000);
    expect(v.status).toBe('partial');
  });

  it('marks fully repaid and overdue loans', () => {
    const full = mk({ type: 'repayment', amount: 1500000, loanId: 'L1' });
    expect(loanViews([lend, back, full], '2025-01-01')[0].status).toBe('repaid');
    expect(loanViews([borrow], '2024-10-16')[0].status).toBe('overdue');
    expect(loanViews([borrow], '2024-10-15')[0].status).toBe('outstanding'); // due today is not overdue
  });

  it('summarises lending and borrowing', () => {
    const t = loanTotals(loanViews([lend, back, borrow], '2024-10-25'));
    expect(t).toEqual({ lent: 2000000, returnedToMe: 500000, owedToMe: 1500000, overdueToMe: 0, borrowed: 1000000, repaidByMe: 0, iOwe: 1000000, overdueByMe: 1000000 });
  });

  it('prevents repayments larger than the remaining balance', () => {
    expect(() => assertRepaymentFits(lend, [back], 1500001)).toThrow(/remaining balance of Rs. 15,000.00/);
    expect(() => assertRepaymentFits(lend, [back], 1500000)).not.toThrow();
  });

  it('computes net loan flow for a period', () => {
    const types = new Map([['L1', 'lend' as const]]);
    expect(periodLoanFlow([lend, back, borrow], (id) => types.get(id))).toEqual({ lending: 1500000, borrowing: 1000000 });
  });

  it('derives account balances only from an opening balance', () => {
    const mcb: Account = { id: 'mcb', name: 'MCB', bankName: 'MCB', kind: 'current', active: true, order: 0 };
    const types = new Map([['L1', 'lend' as const]]);
    expect(accountBalance(mcb, txs, (id) => types.get(id))).toBeNull();
    // 100,000 + 150,000 income − 8,500 expense − 30,000 transfer out − 20,000 lent + 5,000 repaid back
    expect(accountBalance({ ...mcb, openingBalance: 10000000, openingDate: '2024-01-01' }, txs, (id) => types.get(id))).toBe(19650000);
    const soneri = { ...mcb, id: 'soneri', openingBalance: 0 };
    // −12,000 expense + 30,000 transfer in + 10,000 borrowed
    expect(accountBalance(soneri, txs, (id) => types.get(id))).toBe(2800000);
    // transactions before the opening date are ignored
    expect(accountBalance({ ...mcb, openingBalance: 0, openingDate: '2025-01-01' }, txs, () => undefined)).toBe(0);
  });
});
