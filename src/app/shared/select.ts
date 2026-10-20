import { Component, computed, DestroyRef, ElementRef, forwardRef, inject, input, signal, viewChild } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Icon } from './icon';

export interface SelectOption {
  value: string;
  label: string;
}

/** `{ id, name }` records → options, optionally led by an empty choice such as "All". */
export function toOptions(items: readonly { id: string; name: string }[], empty?: string): SelectOption[] {
  const opts = items.map((i) => ({ value: i.id, label: i.name }));
  return empty === undefined ? opts : [{ value: '', label: empty }, ...opts];
}

let seq = 0;
const finePointer = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

/**
 * Searchable dropdown that works with ngModel and formControlName.
 * Pair with `<label [for]>` via `inputId`. Shows a search box once there are more than `searchFrom` options.
 */
@Component({
  selector: 'app-select',
  imports: [Icon],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => Select), multi: true }],
  host: { class: 'select', '(document:pointerdown)': 'outside($event)', '(window:resize)': 'open() && place()', '(keydown)': 'key($event)' },
  template: `
    <button #trigger type="button" class="select-trigger" role="combobox" aria-haspopup="listbox"
            [id]="inputId()" [disabled]="disabled()" [attr.aria-expanded]="open()" [attr.aria-controls]="listId"
            [attr.aria-activedescendant]="open() && !searchable() ? optId(active()) : null" [attr.aria-invalid]="invalid() || null"
            (click)="open() ? close() : show()" (blur)="touched()">
      <span class="select-value" [class.muted]="!selected()">{{ selected()?.label ?? placeholder() }}</span>
      <app-icon name="down" />
    </button>
    @if (open()) {
      <div class="select-panel" [class.up]="pos().up" [style.left.px]="pos().left" [style.width.px]="pos().width"
           [style.top.px]="pos().up ? null : pos().y" [style.bottom.px]="pos().up ? pos().y : null">
        @if (searchable()) {
          <div class="select-search">
            <app-icon name="search" />
            <input #search type="search" placeholder="Search…" autocomplete="off" aria-label="Search options" role="combobox"
                   aria-autocomplete="list" aria-expanded="true" [attr.aria-controls]="listId" [attr.aria-activedescendant]="optId(active())"
                   [value]="q()" (input)="filter($any($event.target).value)" />
          </div>
        }
        <ul role="listbox" [id]="listId" [style.max-height.px]="pos().maxH">
          @for (o of shown(); track o.value; let i = $index) {
            <li role="option" [id]="optId(i)" [class.active]="i === active()" [attr.aria-selected]="o.value === value()"
                (pointermove)="active.set(i)" (click)="pick(o)">
              <span>{{ o.label }}</span>
              @if (o.value === value()) { <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg> }
            </li>
          } @empty {
            <li class="select-empty">No matches for “{{ q() }}”</li>
          }
        </ul>
      </div>
    }
  `,
})
export class Select implements ControlValueAccessor {
  readonly options = input.required<SelectOption[]>();
  readonly inputId = input<string>();
  readonly placeholder = input('Choose…');
  readonly invalid = input(false);
  readonly searchFrom = input(6);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly listId = `select-${++seq}`;
  protected readonly value = signal('');
  protected readonly disabled = signal(false);
  protected readonly open = signal(false);
  protected readonly q = signal('');
  protected readonly active = signal(0);
  protected readonly pos = signal({ left: 0, width: 0, y: 0, maxH: 300, up: false });

  protected readonly searchable = computed(() => this.options().length > this.searchFrom());
  protected readonly selected = computed(() => this.options().find((o) => o.value === this.value()));
  protected readonly shown = computed(() => {
    const q = this.q().trim().toLowerCase();
    return q ? this.options().filter((o) => o.label.toLowerCase().includes(q)) : this.options();
  });

  private onChange = (_: string) => {};
  protected touched = () => {};
  // Keeps the fixed panel glued to the trigger while any ancestor (page, dialog) scrolls.
  private readonly onScroll = (e: Event) => {
    if (!this.host.nativeElement.contains(e.target as Node)) this.place();
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => removeEventListener('scroll', this.onScroll, true));
  }

  writeValue(v: string | null) {
    this.value.set(v ?? '');
  }
  registerOnChange(fn: (v: string) => void) {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void) {
    this.touched = fn;
  }
  setDisabledState(d: boolean) {
    this.disabled.set(d);
  }

  protected optId(i: number) {
    return `${this.listId}-${i}`;
  }

  protected show() {
    if (this.open() || this.disabled()) return;
    this.q.set('');
    this.active.set(Math.max(0, this.options().findIndex((o) => o.value === this.value())));
    this.place();
    this.open.set(true);
    addEventListener('scroll', this.onScroll, true);
    // Touch devices: don't pop the keyboard until the user taps the search box.
    setTimeout(() => {
      if (finePointer) this.search()?.nativeElement.focus();
      this.reveal();
    });
  }

  close(refocus = false) {
    if (!this.open()) return;
    this.open.set(false);
    removeEventListener('scroll', this.onScroll, true);
    if (refocus) this.trigger().nativeElement.focus();
  }

  protected pick(o: SelectOption) {
    if (o.value !== this.value()) {
      this.value.set(o.value);
      this.onChange(o.value);
    }
    this.close(true);
  }

  protected filter(v: string) {
    this.q.set(v);
    this.active.set(0);
  }

  protected outside(e: PointerEvent) {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.close();
  }

  protected key(e: KeyboardEvent) {
    if (!this.open()) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key) && e.target === this.trigger().nativeElement) {
        e.preventDefault();
        this.show();
      }
      return;
    }
    const n = this.shown().length;
    const move = (to: number) => {
      e.preventDefault();
      this.active.set(Math.min(Math.max(to, 0), n - 1));
      this.reveal();
    };
    switch (e.key) {
      case 'ArrowDown': return move(this.active() + 1);
      case 'ArrowUp': return move(this.active() - 1);
      case 'Home': return e.target === this.trigger().nativeElement && move(0);
      case 'End': return e.target === this.trigger().nativeElement && move(n - 1);
      case 'PageDown': return move(this.active() + 8);
      case 'PageUp': return move(this.active() - 8);
      case 'Enter':
      case ' ':
        if (e.key === ' ' && e.target !== this.trigger().nativeElement) return; // spaces are search text
        e.preventDefault();
        if (this.shown()[this.active()]) this.pick(this.shown()[this.active()]);
        return;
      case 'Escape':
        e.preventDefault(); // stop an enclosing <dialog> from closing too
        e.stopPropagation();
        return this.close(true);
      case 'Tab':
        return this.close();
    }
  }

  private reveal() {
    document.getElementById(this.optId(this.active()))?.scrollIntoView({ block: 'nearest' });
  }

  protected place() {
    const r = this.trigger().nativeElement.getBoundingClientRect();
    const below = innerHeight - r.bottom;
    const up = below < 260 && r.top > below;
    const room = (up ? r.top : below) - 16 - (this.searchable() ? 56 : 0);
    this.pos.set({ left: r.left, width: r.width, y: up ? innerHeight - r.top + 4 : r.bottom + 4, maxH: Math.max(120, Math.min(300, room)), up });
  }
}
