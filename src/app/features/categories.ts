import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OTHER_CATEGORY } from '../core/db';
import { Lookups } from '../core/lookups';
import { Category, uid } from '../core/models';
import { Repo } from '../core/repo';
import { Ui } from '../core/ui';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-categories',
  imports: [FormsModule, Icon],
  template: `
    <header class="page-head"><h1>Categories</h1></header>
    <div class="tabs" role="tablist">
      <button role="tab" [class.on]="kind() === 'expense'" [attr.aria-selected]="kind() === 'expense'" (click)="kind.set('expense')">Expense categories</button>
      <button role="tab" [class.on]="kind() === 'income'" [attr.aria-selected]="kind() === 'income'" (click)="kind.set('income')">Income sources</button>
    </div>

    <form class="row card" (ngSubmit)="add()">
      <input name="newName" [(ngModel)]="newName" placeholder="New {{ kind() === 'expense' ? 'category' : 'source' }}" maxlength="100" aria-label="New name" />
      <button class="btn primary" type="submit" [disabled]="!newName().trim()"><app-icon name="add" /> Add</button>
    </form>

    <ul class="card list cats">
      @for (c of list(); track c.id; let i = $index, last = $last) {
        <li class="row between">
          <input [ngModel]="c.name" (change)="rename(c, $any($event.target).value)" maxlength="100" [attr.aria-label]="'Name of ' + c.name" />
          <div class="row nowrap">
            <button class="icon-btn" (click)="move(i, -1)" [disabled]="i === 0" aria-label="Move up"><app-icon name="up" /></button>
            <button class="icon-btn" (click)="move(i, 1)" [disabled]="last" aria-label="Move down"><app-icon name="down" /></button>
            <button class="icon-btn" (click)="remove(c)" [disabled]="isOther(c)" aria-label="Delete"><app-icon name="delete" /></button>
          </div>
        </li>
      }
    </ul>
  `,
})
export class Categories {
  private readonly lookups = inject(Lookups);
  private readonly repo = inject(Repo);
  private readonly ui = inject(Ui);
  protected readonly kind = signal<'expense' | 'income'>('expense');
  protected readonly newName = signal('');
  protected readonly list = computed(() => (this.kind() === 'expense' ? this.lookups.expenseCats() : this.lookups.incomeCats()));

  protected isOther(c: Category) {
    return c.id === OTHER_CATEGORY[c.kind];
  }

  private async run(fn: () => Promise<void>, done?: string) {
    try {
      await fn();
      if (done) this.ui.toast(done);
    } catch (e) {
      this.ui.error(e);
    }
  }

  protected add() {
    const name = this.newName().trim();
    if (!name) return;
    const order = Math.max(-1, ...this.list().map((c) => c.order)) + 1;
    this.run(() => this.repo.saveCategory({ id: uid(), name, kind: this.kind(), order }), 'Category added.').then(() => this.newName.set(''));
  }

  protected rename(c: Category, name: string) {
    if (name.trim() && name.trim() !== c.name) this.run(() => this.repo.saveCategory({ ...c, name: name.trim() }), 'Renamed.');
  }

  protected move(i: number, dir: number) {
    const l = [...this.list()];
    [l[i], l[i + dir]] = [l[i + dir], l[i]];
    this.run(() => this.repo.saveCategoryOrder(l));
  }

  protected async remove(c: Category) {
    if (await this.ui.confirm(`Delete "${c.name}"? Existing records in it will move to "Other".`)) {
      this.run(() => this.repo.deleteCategory(c.id), 'Category deleted.');
    }
  }
}
