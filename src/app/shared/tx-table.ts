import { Component, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { dateLabel } from '../core/dates';
import { Lookups } from '../core/lookups';
import { Tx, TX_LABEL } from '../core/models';
import { MoneyPipe } from '../core/ui';
import { Icon } from './icon';

/** Desktop table that reflows into compact cards on narrow screens (see styles.scss). */
@Component({
  selector: 'app-tx-table',
  imports: [RouterLink, MoneyPipe, Icon],
  template: `
    <table class="table tx-table">
      <thead>
        <tr><th>Date</th><th>Title</th><th>Category / type</th><th>Account</th><th class="num">Amount</th></tr>
      </thead>
      <tbody>
        @for (t of items(); track t.id) {
          <tr (click)="router.navigate(['/tx', t.id])">
            <td class="c-date">{{ dateLabel(t.date) }}</td>
            <td class="c-title">
              <a [routerLink]="['/tx', t.id]" (click)="$event.stopPropagation()">{{ t.title }}</a>
              @if (t.attachmentCount) { <app-icon name="attach" class="sm" [attr.aria-label]="t.attachmentCount + ' attachments'" /> }
              @if (t.counterparty && t.counterparty !== t.title) { <small>{{ t.counterparty }}</small> }
            </td>
            <td class="c-cat">
              @if (t.categoryId) { {{ lookups.catName().get(t.categoryId) }} } @else { <span class="badge" [class]="t.type">{{ label[t.type] }}</span> }
            </td>
            <td class="c-acc">
              {{ lookups.accName().get(t.accountId ?? '') ?? '' }}{{ t.toAccountId ? ' → ' + lookups.accName().get(t.toAccountId) : '' }}
            </td>
            <td class="num amount" [class]="t.type">{{ t.type === 'expense' ? '−' : t.type === 'income' ? '+' : '' }}{{ t.amount | money }}</td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class TxTable {
  readonly items = input.required<Tx[]>();
  protected readonly lookups = inject(Lookups);
  protected readonly router = inject(Router);
  protected readonly label = TX_LABEL;
  protected readonly dateLabel = dateLabel;
}
