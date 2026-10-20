import { Component, DestroyRef, inject, input, model, signal } from '@angular/core';
import { formatBytes, prepareAttachment } from '../core/attachments';
import { Attachment } from '../core/models';
import { NewAttachment } from '../core/repo';
import { Ui } from '../core/ui';
import { Icon } from './icon';

export interface Pending extends NewAttachment {
  url?: string;
}

/** Pick, preview and remove attachments inside a form. The parent saves them with the record. */
@Component({
  selector: 'app-attachment-picker',
  imports: [Icon],
  template: `
    <div class="attach-grid">
      @for (a of existing(); track a.id) {
        @if (!removed().includes(a.id)) {
          <div class="thumb">
            <app-icon [name]="a.type === 'application/pdf' ? 'doc' : 'attach'" />
            <span class="name">{{ a.name }}</span>
            <button type="button" class="icon-btn" (click)="removed.set([...removed(), a.id])" [attr.aria-label]="'Remove ' + a.name"><app-icon name="close" /></button>
          </div>
        }
      }
      @for (p of pending(); track p.meta.id) {
        <div class="thumb">
          @if (p.url) {
            <img [src]="p.url" alt="" />
          } @else {
            <app-icon name="doc" />
          }
          <span class="name">{{ p.meta.name }} · {{ size(p.meta.size) }}</span>
          <button type="button" class="icon-btn" (click)="drop(p)" [attr.aria-label]="'Remove ' + p.meta.name"><app-icon name="close" /></button>
        </div>
      }
    </div>
    <div class="row">
      <label class="btn ghost sm">
        <app-icon name="attach" /> Add file
        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple (change)="pick($event)" hidden />
      </label>
      @if (touch) {
        <label class="btn ghost sm">
          <app-icon name="camera" /> Take photo
          <input type="file" accept="image/*" capture="environment" (change)="pick($event)" hidden />
        </label>
      }
      @if (busy()) {
        <span class="muted">Processing…</span>
      }
    </div>
  `,
})
export class AttachmentPicker {
  readonly existing = input<Attachment[]>([]);
  readonly pending = model<Pending[]>([]);
  readonly removed = model<string[]>([]);
  protected readonly busy = signal(false);
  protected readonly touch = matchMedia('(pointer: coarse)').matches;
  private ui = inject(Ui);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.pending().forEach((p) => p.url && URL.revokeObjectURL(p.url)));
  }

  protected size = formatBytes;

  protected async pick(e: Event) {
    const inputEl = e.target as HTMLInputElement;
    const files = [...(inputEl.files ?? [])];
    inputEl.value = '';
    this.busy.set(true);
    for (const f of files) {
      try {
        const p: Pending = await prepareAttachment(f);
        if (p.meta.type.startsWith('image/')) p.url = URL.createObjectURL(p.blob);
        this.pending.update((list) => [...list, p]);
      } catch (err) {
        this.ui.error(err);
      }
    }
    this.busy.set(false);
  }

  protected drop(p: Pending) {
    if (p.url) URL.revokeObjectURL(p.url);
    this.pending.update((list) => list.filter((x) => x !== p));
  }
}
