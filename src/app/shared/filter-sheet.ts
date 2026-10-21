import { Component, ElementRef, input, output, viewChild } from '@angular/core';
import { Icon } from './icon';

let seq = 0;

/** "Filters" button that opens its projected controls in a popup. Changes apply live; the popup only closes. */
@Component({
  selector: 'app-filter-sheet',
  imports: [Icon],
  template: `
    <button type="button" class="btn filter-btn" [class.on]="active()" aria-haspopup="dialog" (click)="dlg.showModal()">
      <app-icon name="filter" /> Filters
      @if (active()) { <span class="filter-count" [attr.aria-label]="active() + ' active'">{{ active() }}</span> }
    </button>
    <dialog #dlg class="sheet filter-sheet" [attr.aria-labelledby]="titleId" (click)="backdrop($event)">
      <div class="sheet-body">
        <div class="sheet-head">
          <h2 [id]="titleId">{{ title() }}</h2>
          <button type="button" class="icon-btn" (click)="close()" aria-label="Close"><app-icon name="close" /></button>
        </div>
        <ng-content />
        <div class="row end sheet-actions">
          @if (active()) { <button type="button" class="btn ghost" (click)="clear.emit()">Clear all</button> }
          <button type="button" class="btn primary" (click)="close()">Done</button>
        </div>
      </div>
    </dialog>
  `,
})
export class FilterSheet {
  readonly title = input('Filters');
  readonly active = input(0);
  readonly clear = output();

  protected readonly titleId = `filter-title-${++seq}`;
  protected readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  protected close() {
    this.dlg().nativeElement.close();
  }

  // A handler that returns false makes Angular call preventDefault, which silently blocks checkboxes inside.
  protected backdrop(e: MouseEvent) {
    if (e.target === this.dlg().nativeElement) this.close();
  }
}
