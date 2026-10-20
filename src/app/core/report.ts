import { jsPDF } from 'jspdf';
import autoTableBase, { UserOptions } from 'jspdf-autotable';
import { dateLabel, daysInclusive } from './dates';
import { Group, groupBy, LOAN_STATUS_LABEL, LoanTotals, loanTotals, LoanView, loanViews, totals, Totals } from './finance';
import { Account, Category, PAYMENT_METHODS, Tx, TX_LABEL } from './models';
import { formatMoney } from './money';

export type ReportKind = 'overview' | 'expense' | 'income' | 'loans';

export interface ReportOptions {
  from: string;
  to: string;
  accountId?: string;
  categoryId?: string;
  kind: ReportKind;
  includeLoans: boolean;
  /** Drop names, notes, references and contacts. */
  redact: boolean;
}

export interface ReportInput {
  txs: Tx[];
  prevTxs: Tx[];
  loanRecords: Tx[];
  accounts: Account[];
  categories: Category[];
  today: string;
}

export interface ReportRow {
  date: string;
  type: string;
  title: string;
  category: string;
  account: string;
  amount: number;
  notes: string;
  reference: string;
  counterparty: string;
}

export interface ReportData {
  opts: ReportOptions;
  generatedAt: Date;
  totals: Totals;
  prevTotals: Totals;
  days: number;
  avgDailySpend: number;
  byAccount: Group[];
  byCategory: Group[];
  incomeBySource: Group[];
  largest: ReportRow[];
  rows: ReportRow[];
  loans: LoanView[];
  loanTotals: LoanTotals;
  showLoans: boolean;
}

/** Pure: turns persisted records into report numbers. All totals exclude transfers and loan principal. */
export function buildReport(input: ReportInput, opts: ReportOptions): ReportData {
  const accName = new Map(input.accounts.map((a) => [a.id, opts.redact ? a.bankName : a.name]));
  const catName = new Map(input.categories.map((c) => [c.id, c.name]));
  const pm = new Map(PAYMENT_METHODS.map((p) => [p.id as string, p.name]));

  const match = (t: Tx) =>
    t.date >= opts.from &&
    t.date <= opts.to &&
    (!opts.accountId || t.accountId === opts.accountId || t.toAccountId === opts.accountId) &&
    (!opts.categoryId || t.categoryId === opts.categoryId);
  const types: Record<ReportKind, Tx['type'][]> = {
    overview: ['expense', 'income', 'lend', 'borrow', 'repayment', 'transfer'],
    expense: ['expense'],
    income: ['income'],
    loans: ['lend', 'borrow', 'repayment'],
  };
  const txs = input.txs.filter((t) => match(t) && types[opts.kind].includes(t.type));
  const prev = input.prevTxs.filter((t) => (!opts.accountId || t.accountId === opts.accountId) && (!opts.categoryId || t.categoryId === opts.categoryId) && types[opts.kind].includes(t.type));

  const names = new Map<string, string>();
  const person = (name = '') => {
    if (!opts.redact) return name;
    if (!names.has(name)) names.set(name, `Person ${names.size + 1}`);
    return names.get(name)!;
  };
  const toRow = (t: Tx): ReportRow => ({
    date: t.date,
    type: TX_LABEL[t.type],
    title: opts.redact && t.type !== 'expense' && t.type !== 'income' ? TX_LABEL[t.type] : t.title,
    category: (t.categoryId && catName.get(t.categoryId)) || '',
    account:
      t.type === 'transfer'
        ? `${accName.get(t.accountId!) ?? '?'} -> ${accName.get(t.toAccountId!) ?? '?'}`
        : (t.accountId && accName.get(t.accountId)) || (t.paymentMethod && pm.get(t.paymentMethod)) || '',
    amount: t.amount,
    notes: opts.redact ? '' : t.notes ?? '',
    reference: opts.redact ? '' : t.reference ?? '',
    counterparty: t.type === 'lend' || t.type === 'borrow' || t.type === 'repayment' ? person(t.counterparty) : opts.redact ? '' : t.counterparty ?? '',
  });

  const tot = totals(txs);
  const days = daysInclusive(opts.from, opts.to);
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));

  const showLoans = opts.kind === 'loans' || (opts.kind === 'overview' && opts.includeLoans);
  const views = loanViews(input.loanRecords, input.today).filter(
    (v) => v.loan.date <= opts.to && (!opts.accountId || v.loan.accountId === opts.accountId) && (v.remaining > 0 || v.loan.date >= opts.from || v.repayments.some((r) => r.date >= opts.from)),
  );
  if (opts.redact) {
    const scrub = (t: Tx): Tx => ({ ...t, title: TX_LABEL[t.type], counterparty: person(t.counterparty), notes: undefined, contact: undefined, reference: undefined });
    for (const v of views) (v.loan = scrub(v.loan)), (v.repayments = v.repayments.map(scrub));
  }

  return {
    opts,
    generatedAt: new Date(),
    totals: tot,
    prevTotals: totals(prev),
    days,
    avgDailySpend: Math.round(tot.expense / days),
    byAccount: groupBy(txs, 'expense', (t) => (t.accountId && accName.get(t.accountId)) || 'Unspecified'),
    byCategory: groupBy(txs, 'expense', (t) => (t.categoryId && catName.get(t.categoryId)) || 'Uncategorised'),
    incomeBySource: groupBy(txs, 'income', (t) => (t.categoryId && catName.get(t.categoryId)) || 'Other'),
    largest: txs.filter((t) => t.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 10).map(toRow),
    rows: sorted.map(toRow),
    loans: views,
    loanTotals: loanTotals(views),
    showLoans,
  };
}

/** jsPDF's built-in fonts only cover Latin-1; map common symbols and replace the rest. */
export const pdfSafe = (s: string) =>
  s.replace(/[→⇒]/g, '->').replace(/[−–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?');

/** autoTable with Latin-1-safe text and header alignment matching each column. */
function autoTable(doc: jsPDF, opts: UserOptions) {
  autoTableBase(doc, {
    ...opts,
    didParseCell: (d) => {
      d.cell.text = d.cell.text.map(pdfSafe);
      const col = (opts.columnStyles as Record<number, { halign?: 'left' | 'right' }> | undefined)?.[d.column.index];
      if (d.section === 'head' && col?.halign) d.cell.styles.halign = col.halign;
    },
  });
}

const pctChange = (now: number, before: number) => (before ? `${(((now - before) / before) * 100).toFixed(1)}%` : 'n/a');

export function renderPdf(r: ReportData): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  const NAVY: [number, number, number] = [30, 41, 99];
  const money = formatMoney;
  const { opts } = r;
  const period = `${dateLabel(opts.from)} - ${dateLabel(opts.to)}`;
  const head = { fillColor: NAVY, textColor: 255, fontStyle: 'bold' as const };
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const heading = (text: string, y = 20) => {
    doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...NAVY).text(text, M, y);
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90);
    return y + 6;
  };
  const bars = (groups: Group[], y: number) => {
    const top = groups.slice(0, 10);
    const max = Math.max(1, ...top.map((g) => g.total));
    const labelW = 55;
    const barW = W - M * 2 - labelW - 40;
    doc.setFontSize(8.5);
    top.forEach((g, i) => {
      const yy = y + i * 7;
      doc.setTextColor(60).text(pdfSafe(g.key.slice(0, 30)), M, yy + 4);
      doc.setFillColor(...NAVY).rect(M + labelW, yy, Math.max(0.5, (g.total / max) * barW), 5, 'F');
      doc.text(`${g.pct.toFixed(1)}%`, M + labelW + barW + 3, yy + 4);
    });
    return y + top.length * 7 + 4;
  };
  const kindLabel = { overview: 'Financial overview', expense: 'Expense report', income: 'Income report', loans: 'Lending & borrowing report' }[opts.kind];

  // Page 1: summary
  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...NAVY).text(kindLabel, M, 22);
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(90).text(period, M, 29);
  const summary: [string, string][] = [];
  if (opts.kind !== 'loans') {
    summary.push(
      ['Total expenses', money(r.totals.expense)],
      ['Total income', money(r.totals.income)],
      ['Net cash flow', money(r.totals.net)],
      ['Income & expense transactions', String(r.totals.count)],
      ['Average daily spending', money(r.avgDailySpend)],
      ['Expenses vs previous period', `${money(r.prevTotals.expense)} (${pctChange(r.totals.expense, r.prevTotals.expense)})`],
      ['Income vs previous period', `${money(r.prevTotals.income)} (${pctChange(r.totals.income, r.prevTotals.income)})`],
    );
  }
  if (r.showLoans || opts.kind === 'overview') {
    summary.push(['Outstanding: owed to me', money(r.loanTotals.owedToMe)], ['Outstanding: I owe', money(r.loanTotals.iOwe)]);
  }
  autoTable(doc, {
    startY: 36,
    margin: { left: M, right: M },
    body: summary,
    theme: 'striped',
    styles: { fontSize: 11, cellPadding: 3 },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
  });
  doc.setFontSize(8.5).setTextColor(120).text('Transfers between own accounts and loan principal are excluded from income and expense totals.', M, lastY() + 7);

  // Page 2: bank-wise spending
  if (opts.kind === 'overview' || opts.kind === 'expense') {
    doc.addPage();
    const y = heading('Spending by bank / account');
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [['Bank / account', 'Transactions', 'Total spending', '% of expenses']],
      body: r.byAccount.map((g) => [g.key, g.count, money(g.total), `${g.pct.toFixed(1)}%`]),
      headStyles: head,
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    });
    bars(r.byAccount, lastY() + 10);

    // Page 3: categories
    doc.addPage();
    let y3 = heading('Category analysis');
    autoTable(doc, {
      startY: y3,
      margin: { left: M, right: M },
      head: [['Category', 'Transactions', 'Total', '%']],
      body: r.byCategory.map((g) => [g.key, g.count, money(g.total), `${g.pct.toFixed(1)}%`]),
      headStyles: head,
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    });
    y3 = bars(r.byCategory, lastY() + 10);
    if (y3 > 230) doc.addPage(), (y3 = 20);
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...NAVY).text('Largest expenses', M, y3 + 4);
    autoTable(doc, {
      startY: y3 + 8,
      margin: { left: M, right: M },
      head: [['Date', 'Title', 'Category', 'Amount']],
      body: r.largest.map((t) => [dateLabel(t.date), t.title, t.category, money(t.amount)]),
      headStyles: head,
      columnStyles: { 3: { halign: 'right' } },
    });
  }

  if (opts.kind === 'income' && r.incomeBySource.length) {
    doc.addPage();
    const y = heading('Income by source');
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [['Source', 'Transactions', 'Total', '%']],
      body: r.incomeBySource.map((g) => [g.key, g.count, money(g.total), `${g.pct.toFixed(1)}%`]),
      headStyles: head,
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    });
  }

  // Page 4: detailed transactions
  if (opts.kind !== 'loans') {
    doc.addPage();
    const y = heading('Detailed transactions');
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [['Date', 'Type', 'Title', 'Category', 'Bank / method', 'Amount', 'Notes']],
      body: r.rows.map((t) => [dateLabel(t.date), t.type, t.title, t.category, t.account, money(t.amount), t.notes.slice(0, 80)]),
      headStyles: head,
      showHead: 'everyPage',
      styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak' },
      columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 17 }, 5: { halign: 'right', cellWidth: 26 }, 6: { cellWidth: 35 } },
    });
  }

  // Page 5: loans
  if (r.showLoans) {
    doc.addPage();
    let y = heading('Lending & borrowing');
    const t = r.loanTotals;
    doc.text(`Lent ${money(t.lent)} - returned ${money(t.returnedToMe)} - still owed to me ${money(t.owedToMe)}`, M, y);
    doc.text(`Borrowed ${money(t.borrowed)} - repaid ${money(t.repaidByMe)} - I still owe ${money(t.iOwe)}`, M, y + 5);
    autoTable(doc, {
      startY: y + 10,
      margin: { left: M, right: M },
      head: [['Person', 'Direction', 'Date', 'Original', 'Repaid', 'Remaining', 'Due', 'Status']],
      body: r.loans.map((v) => [
        v.loan.counterparty ?? '',
        v.loan.type === 'lend' ? 'Lent' : 'Borrowed',
        dateLabel(v.loan.date),
        money(v.loan.amount),
        money(v.repaid),
        money(v.remaining),
        v.loan.dueDate ? dateLabel(v.loan.dueDate) : '-',
        LOAN_STATUS_LABEL[v.status],
      ]),
      headStyles: head,
      showHead: 'everyPage',
      styles: { fontSize: 8 },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    });
    const history = r.loans.flatMap((v) => v.repayments.map((p) => [v.loan.counterparty ?? '', dateLabel(p.date), money(p.amount), opts.redact ? '' : p.notes ?? '']));
    if (history.length) {
      y = lastY() + 10;
      doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...NAVY).text('Repayment history', M, y);
      autoTable(doc, {
        startY: y + 4,
        margin: { left: M, right: M },
        head: [['Person', 'Date', 'Amount', 'Notes']],
        body: history,
        headStyles: head,
        showHead: 'everyPage',
        styles: { fontSize: 8 },
        columnStyles: { 2: { halign: 'right' } },
      });
    }
  }

  const pages = doc.getNumberOfPages();
  const stamp = `Generated ${r.generatedAt.toLocaleString('en-GB')}${opts.redact ? ' - personal details removed' : ''}`;
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(130);
    const H = doc.internal.pageSize.getHeight();
    doc.text(stamp, M, H - 8);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 8, { align: 'right' });
  }
  return doc.output('blob');
}

const csvCell = (v: string | number) => {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // block spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: ReportRow[], currencyCode: string, redact: boolean): string {
  const header = ['Date', 'Type', 'Title', 'Category', 'Account', `Amount (${currencyCode})`, ...(redact ? [] : ['Counterparty', 'Reference', 'Notes'])];
  const lines = rows.map((r) =>
    [r.date, r.type, r.title, r.category, r.account, `${Math.floor(r.amount / 100)}.${String(r.amount % 100).padStart(2, '0')}`, ...(redact ? [] : [r.counterparty, r.reference, r.notes])]
      .map(csvCell)
      .join(','),
  );
  return [header.map(csvCell).join(','), ...lines].join('\r\n');
}
