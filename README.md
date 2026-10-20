# Expense Tracker — private, offline-first PWA

Personal expenses, income, bank accounts, receipts, lending/borrowing and transfers.
Angular 21 (standalone, zoneless, signals) · IndexedDB via Dexie · jsPDF · Chart.js · fflate · Angular service worker.
**No backend. Every record and receipt stays in the browser on your device.**

> Angular 22 needs Node ≥ 24.15; this machine has Node 24.11, so the project uses Angular 21.2 (latest compatible).
> Upgrade Node, then `ng update @angular/core @angular/cli` to move to 22.

## Commands

```bash
npm install
npm start                 # dev server http://localhost:4200 (service worker disabled in dev)
npm test                  # 40 unit tests (Vitest + fake-indexeddb)
npm run e2e               # 14 Playwright runs (desktop + Pixel 7) against the production build, uses local Chrome
E2E_BASE_URL=https://mufeez1.github.io/expense-tracker-pwa/ npm run e2e   # same suite against the live site
npm run build             # production build -> dist/expense-tracker/browser
npm run serve:prod        # serve the production build on http://localhost:4300 (service worker active)
node scripts/demo-data.mjs 600 demo-backup.zip   # importable demo data (use 10000 to benchmark)
npm run icons             # re-render public/icons from the SVG in scripts/icons.mjs
```

## Project layout

```
src/app/
  core/            data + logic, no UI
    models.ts        typed records (Tx, Account, Category, Attachment)
    db.ts            Dexie schema, versioned migrations, default banks/categories
    repo.ts          repository: all reads/writes, atomic saves, paginated queries
    finance.ts       accounting rules: totals, groupings, loan balances/status, account balances
    validate.ts      record validation shared by saves and backup import
    money.ts/dates.ts  integer-paisa money and timezone-free YYYY-MM-DD dates
    attachments.ts   file validation + client-side image compression
    backup.ts        ZIP export / validated import (merge or replace)
    report.ts        report numbers, PDF (jsPDF + autotable), CSV
    ui.ts/pwa.ts/lookups.ts  toasts, confirm, signal loader, install/update/storage
  shared/          icon, chart, transaction table, attachment picker
  features/        lazy-loaded pages: dashboard, tx-list, tx-form, tx-detail, loans,
                   reports, accounts, categories, backup, settings, more
e2e/               Playwright tests
scripts/           static server, icon renderer, demo data generator
```

## Data model & storage

One `transactions` table holds every money movement, discriminated by `type`:
`expense | income | lend | borrow | repayment | transfer`.

- Amounts are **integer minor units** (paisa). `parseMoney("0.29") === 29`; no floats anywhere in totals.
- Dates are local `YYYY-MM-DD` strings, so ranges are string comparisons and never shift across timezones.
- Repayments are separate records linked by `loanId`. Loan balances are always derived; the original amount is never edited by a repayment.
- Attachment **metadata** (`attachments`) and **bytes** (`blobs`) are separate tables, so lists never load file data.
- Indexes: `type, date, accountId, toAccountId, categoryId, loanId, updatedAt, [type+date]`.
- Every save of a record + its attachments runs in one IndexedDB transaction; a failure (e.g. quota exceeded) leaves nothing half-written.

**Migrations:** never edit an existing `this.version(n)` in `db.ts`. Add `this.version(n + 1).stores({...}).upgrade(tx => ...)`; Dexie runs pending upgrades in order.

### Accounting rules

| Record | Cash-flow totals | Account balance | Loans |
|---|---|---|---|
| Expense | expense | − | |
| Income | income | + | |
| Lend | excluded | − | receivable + |
| Borrow | excluded | + | liability + |
| Repayment (of a loan you gave) | excluded | + | receivable − |
| Repayment (of a loan you took) | excluded | − | liability − |
| Transfer | excluded | − source / + destination | |

Account balances are shown only for accounts with an opening balance (applied from the opening date).
Repayments larger than the remaining balance are rejected, and a loan can't be edited below what was already repaid.

## Backup & restore

Backup = ZIP with `backup.json` (`{ app, format: 1, exportedAt, data }`) plus `attachments/<id>` files. It is **not encrypted**.

Import validates every record, attachment type and cross-reference before writing anything, previews counts,
duplicates and conflicts, then writes in **one transaction** — an interrupted or failed import rolls back completely.

- **Merge**: new records are added; for duplicate ids the copy with the newer `updatedAt` wins; local accounts/categories/settings are kept.
- **Replace**: deletes local data first (asks for confirmation).

## Deployment

**Live:** https://mufeez1.github.io/expense-tracker-pwa/

Every push to `main` runs `.github/workflows/pages.yml`, which installs, runs the unit tests, builds with
`--base-href /expense-tracker-pwa/`, copies `index.html` to `404.html` (deep links like `/loans` load the app,
with HTTP status 404, which browsers ignore) and publishes to GitHub Pages. Check runs with `gh run list`.
To test the sub-path build locally: `npx ng build --base-href /expense-tracker-pwa/ && node scripts/ngsw-unpin-index.mjs && node scripts/serve.mjs 4301 /expense-tracker-pwa/`.

`netlify.toml` is kept for hosting on Netlify instead; note that Netlify's free plan adds a "Powered by Netlify" badge.

Any static HTTPS host (Netlify, Vercel, Cloudflare Pages, GitHub Pages, nginx). Requirements:

1. Upload `dist/expense-tracker/browser`.
2. **HTTPS** (service workers and install need it; `localhost` is exempt).
3. SPA fallback: unknown paths → `/index.html` (Netlify: `/* /index.html 200`).
4. Serve `ngsw-worker.js` and `ngsw.json` without long-lived caching.

`npm run build` also runs `scripts/ngsw-unpin-index.mjs`, which drops `index.html` from the service
worker's hash table. Netlify injects a comment into served HTML; without this step the hash check fails
and offline mode silently stops working. The local test server injects a comment too, so e2e covers it.

On the first visit the service worker downloads the app in the background (about 25 s on a slow
connection). Offline use works from the next launch after that.

When a new version is deployed, open apps show "A new version is available — Reload".

## Install & test on devices

**iPhone / iPad (Safari, iOS 16.4+ recommended)**
- [ ] Open the HTTPS URL in Safari → Share → Add to Home Screen → open from the Home Screen icon
- [ ] Add an expense with **Take photo** and with a screenshot from Photos; open it full-screen
- [ ] Turn on Airplane mode, force-quit, reopen: app loads, records visible, add/edit works
- [ ] Reports → Share PDF → Save to Files; Backup → Create backup → Share / Save to Files
- [ ] Notch/home-indicator: bottom nav and sheets aren't covered
- [ ] Settings → Storage shows usage; tap **Request persistent storage**

**Android (Chrome)**
- [ ] Open the URL → **Install app** (Settings page button or Chrome ⋮ menu) → launches standalone with icon
- [ ] Camera capture and gallery upload; PDF/backup share and download
- [ ] Airplane mode: open, add, search, generate a report
- [ ] Deploy a new build → reopen → "new version" banner → Reload

**Desktop**: install icon in Chrome/Edge address bar; tables show full columns ≥ 700 px, sidebar ≥ 900 px.

## Measured performance

Real Chrome (M-series Mac), 10,061 records imported from `scripts/demo-data.mjs 10000`:
import 3.0 s · page loads ~0.6 s · filtered search ~0.2 s after the 250 ms debounce · PDF of all records 1.5 s · backup export 0.3 s.
Lists page 50 rows at a time ("Load more"); date-sorted lists stream from the date index.

## Known limitations

- Data lives in one browser profile on one device. No sync. Clearing site data, uninstalling, or losing the device loses data — **export backups**.
- iOS Safari may evict storage for sites not added to the Home Screen; persistent storage is a request, not a guarantee. Storage capacity depends on the device.
- Local data and backups are **not encrypted** by the app (device encryption/passcode still applies).
- PDF uses jsPDF's built-in Latin-1 fonts: Urdu/Arabic or other non-Latin text appears as `?` in PDFs (CSV and the app display it fine). Embedding a Unicode font would add ~MBs.
- Non-date sorts (amount/title/updated) sort the filtered set in memory — fine for tens of thousands of rows.
- Backup ZIPs are built in memory; very large receipt libraries need enough device RAM.
- Interest/fees on loans, recurring transactions, and multi-currency conversion are not implemented. Changing the currency only changes the label.
- Unsaved-form recovery restores typed fields, not picked attachments.
