import { expect, Page, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** Pick from the custom dropdown, typing into its search box when it has one. */
async function choose(page: Page, label: string | RegExp, option: string, opts?: { exact?: boolean }) {
  await page.getByLabel(label, opts).click();
  const search = page.getByLabel('Search options');
  if (await search.isVisible()) await search.fill(option.slice(0, 4));
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function addExpense(page: Page, amount: string, title: string, bank = 'MCB Bank') {
  await page.goto('/new/expense');
  await page.getByLabel(/^Amount/).fill(amount);
  await choose(page, 'Category', 'Food and groceries', { exact: true });
  await choose(page, 'Paid from', bank);
  await page.getByLabel(/^Title/).fill(title);
}

test('adds an expense with a receipt, persists it, then deletes it', async ({ page }) => {
  await addExpense(page, '8,500', 'Groceries');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText(/receipt\.png/)).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Expense saved.')).toBeVisible();
  await expect(page.locator('.detail-amount')).toHaveText('Rs. 8,500.00');
  await page.reload(); // IndexedDB persistence
  await expect(page.locator('.detail-amount')).toHaveText('Rs. 8,500.00');
  await expect(page.getByRole('button', { name: 'Open receipt.png' })).toBeVisible();
  const detailUrl = page.url();

  await page.goto('/expenses');
  await expect(page.getByRole('link', { name: 'Groceries' })).toBeVisible();
  await page.getByLabel('Search', { exact: true }).fill('grocer');
  await expect(page.getByText('1 record')).toBeVisible();
  await page.getByRole('button', { name: 'Filters' }).click();
  await choose(page, 'Payment method', 'Cash');
  await expect(page.getByText('0 records')).toBeVisible();
  await page.getByRole('button', { name: 'Clear all' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('1 record')).toBeVisible();

  await page.goto(detailUrl);
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.locator('dialog.confirm').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Deleted.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Groceries' })).toHaveCount(0);
});

test('validates the amount field', async ({ page }) => {
  await page.goto('/new/expense');
  await page.getByLabel(/^Amount/).fill('12.345');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Enter an amount greater than zero/)).toBeVisible();
  await expect(page.getByText(/Choose a category/)).toBeVisible();
});

test('lending with partial repayment; overpayment is blocked; totals stay separate', async ({ page }) => {
  await page.goto('/new/lend');
  await page.getByLabel(/^Amount/).fill('20000');
  await page.getByLabel('Person you lent to').fill('Ahmed');
  await choose(page, 'Paid from', 'MCB Bank');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.detail-amount')).toHaveText('Rs. 20,000.00');

  await page.getByRole('link', { name: 'Record repayment' }).click();
  await expect(page.getByLabel(/^Amount/)).toHaveValue('20000.00'); // prefilled with the remaining balance
  await page.getByLabel(/^Amount/).fill('25000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/can't exceed the remaining Rs. 20,000.00/)).toBeVisible();
  await page.getByLabel(/^Amount/).fill('5000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Repayment saved.')).toBeVisible();

  await page.goto('/loans');
  const row = page.locator('.loan-table tr', { hasText: 'Ahmed' });
  await expect(row).toContainText('Rs. 15,000.00');
  await expect(row).toContainText('Partially repaid');

  await page.goto('/');
  await expect(page.locator('.stat', { hasText: 'Owed to me' })).toContainText('Rs. 15,000.00');
  await expect(page.locator('.stat', { hasText: 'Expenses ·' })).toContainText('Rs. 0.00');
  await expect(page.locator('.stat', { hasText: 'Income ·' })).toContainText('Rs. 0.00');
});

test('transfers between own accounts are not income or expense', async ({ page }) => {
  await page.goto('/new/transfer');
  await page.getByLabel(/^Amount/).fill('30000');
  await choose(page, 'From account', 'MCB Bank');
  await choose(page, 'To account', 'MCB Bank');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Choose a different destination account.')).toBeVisible();
  await choose(page, 'To account', 'Soneri Bank');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'MCB Bank → Soneri Bank' })).toBeVisible();
  await page.goto('/');
  await expect(page.locator('.stat', { hasText: 'Net cash flow' })).toContainText('Rs. 0.00');
});

test('navigation adapts to the screen size', async ({ page, isMobile }) => {
  await page.goto('/');
  if (isMobile) {
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await expect(page.locator('.sidebar')).toBeHidden();
    await page.getByRole('button', { name: 'Add record' }).click();
  } else {
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.bottom-nav')).toBeHidden();
    await page.getByRole('button', { name: 'Add record' }).click();
  }
  const sheet = page.locator('dialog.sheet');
  for (const a of ['Add expense', 'Add income', 'Lend money', 'Borrow money', 'Record repayment', 'Transfer between accounts']) {
    await expect(sheet.getByRole('link', { name: a })).toBeVisible();
  }
  await sheet.getByRole('link', { name: 'Add income' }).click();
  await expect(page.getByRole('heading', { name: 'Income' })).toBeVisible();
});

test('PDF, CSV and backup export, then restore into a fresh browser', async ({ page, browser, isMobile }) => {
  test.skip(isMobile, 'download flow covered on desktop');
  await addExpense(page, '12000', 'Electricity bill', 'Soneri Bank');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Expense saved.')).toBeVisible();

  await page.goto('/reports');
  await expect(page.locator('.stat', { hasText: 'Expenses' })).toContainText('Rs. 12,000.00');
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/^report-overview-.*\.pdf$/);
  expect((await readFile(await pdf.path())).subarray(0, 5).toString()).toBe('%PDF-');
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
  expect((await readFile(await csv.path(), 'utf8'))).toContain('Electricity bill');

  await page.goto('/backup');
  await page.getByRole('button', { name: 'Create backup' }).click();
  const [zip] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download expense-tracker-backup/ }).click()]);
  const zipPath = await zip.path();

  const fresh = await browser.newPage();
  await fresh.goto('/backup');
  await fresh.locator('input[type=file]').setInputFiles(zipPath);
  await expect(fresh.getByText('1 records')).toBeVisible();
  await fresh.getByRole('button', { name: 'Restore' }).click();
  await fresh.locator('dialog.confirm').getByRole('button', { name: 'Merge' }).click();
  await expect(fresh.getByText(/Restore complete: 1 added/)).toBeVisible();
  await fresh.goto('/transactions');
  await expect(fresh.getByRole('link', { name: 'Electricity bill' })).toBeVisible();
  await fresh.close();
});

test('works offline after the first visit', async ({ page, context, isMobile }) => {
  test.skip(isMobile, 'offline flow covered on desktop');
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  });
  // Wait until the Angular SW has prefetched every app file; it writes the group's metadata last.
  // (expect.poll, not waitForFunction: an async predicate's Promise would count as truthy at once.)
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const meta = (await caches.keys()).find((k) => k.endsWith(':assets:app:meta'));
          return !!meta && (await (await caches.open(meta)).keys()).length > 0;
        }),
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText(/You're offline/)).toBeVisible();
  await page.goto('/reports'); // lazy route served from the SW cache
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await addExpense(page, '500', 'Offline tea');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Expense saved.')).toBeVisible();
  await context.setOffline(false);
});
