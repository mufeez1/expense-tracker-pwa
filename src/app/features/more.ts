import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon, IconName } from '../shared/icon';

@Component({
  selector: 'app-more',
  imports: [RouterLink, Icon],
  template: `
    <header class="page-head"><h1>More</h1></header>
    <nav class="card list menu" aria-label="More">
      @for (l of links; track l.label) {
        <a [routerLink]="l.to" [fragment]="l.fragment"><app-icon [name]="l.icon" /> {{ l.label }}</a>
      }
    </nav>
  `,
})
export class More {
  protected readonly links: { to: string; label: string; icon: IconName; fragment?: string }[] = [
    { to: '/expenses', label: 'Expenses', icon: 'expense' },
    { to: '/income', label: 'Income', icon: 'income' },
    { to: '/transfers', label: 'Transfers', icon: 'swap' },
    { to: '/accounts', label: 'Banks & accounts', icon: 'bank' },
    { to: '/categories', label: 'Categories', icon: 'tag' },
    { to: '/backup', label: 'Backup & restore', icon: 'backup' },
    { to: '/settings', label: 'Settings & storage', icon: 'settings' },
    { to: '/settings', label: 'Install the app', icon: 'download', fragment: 'install' },
  ];
}
