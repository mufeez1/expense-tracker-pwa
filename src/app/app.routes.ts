import { Routes } from '@angular/router';

const list = () => import('./features/tx-list').then((m) => m.TxList);
const form = () => import('./features/tx-form').then((m) => m.TxForm);

export const routes: Routes = [
  { path: '', title: 'Home · Expense Tracker', loadComponent: () => import('./features/dashboard').then((m) => m.Dashboard) },
  { path: 'transactions', title: 'Transactions', loadComponent: list, data: { heading: 'All transactions' } },
  { path: 'expenses', title: 'Expenses', loadComponent: list, data: { heading: 'Expenses', types: ['expense'] } },
  { path: 'income', title: 'Income', loadComponent: list, data: { heading: 'Income', types: ['income'] } },
  { path: 'transfers', title: 'Transfers', loadComponent: list, data: { heading: 'Transfers', types: ['transfer'] } },
  { path: 'new/:type', title: 'New record', loadComponent: form },
  { path: 'tx/:id/edit', title: 'Edit record', loadComponent: form },
  { path: 'tx/:id', title: 'Record', loadComponent: () => import('./features/tx-detail').then((m) => m.TxDetail) },
  { path: 'loans', title: 'People & Loans', loadComponent: () => import('./features/loans').then((m) => m.Loans) },
  { path: 'reports', title: 'Reports', loadComponent: () => import('./features/reports').then((m) => m.Reports) },
  { path: 'accounts', title: 'Banks & accounts', loadComponent: () => import('./features/accounts').then((m) => m.Accounts) },
  { path: 'categories', title: 'Categories', loadComponent: () => import('./features/categories').then((m) => m.Categories) },
  { path: 'backup', title: 'Backup & restore', loadComponent: () => import('./features/backup').then((m) => m.Backup) },
  { path: 'settings', title: 'Settings', loadComponent: () => import('./features/settings').then((m) => m.Settings) },
  { path: 'more', title: 'More', loadComponent: () => import('./features/more').then((m) => m.More) },
  { path: '**', redirectTo: '' },
];
