import { effect, inject, Injectable, Pipe, PipeTransform, signal, Signal, untracked } from '@angular/core';
import { AppError } from './models';
import { formatMoney } from './money';

export function friendlyError(e: unknown): string {
  const err = e as { name?: string; inner?: { name?: string }; message?: string };
  if (err?.name === 'QuotaExceededError' || err?.inner?.name === 'QuotaExceededError') {
    return 'Device storage is full, so nothing was saved. Free up space or export a backup and remove large attachments.';
  }
  if (e instanceof AppError) return e.message;
  // Log only the error type, never record contents.
  console.error('Unexpected error:', err?.name ?? typeof e);
  return 'Something went wrong. Your data was not changed.';
}

@Injectable({ providedIn: 'root' })
export class Ui {
  readonly toasts = signal<{ id: number; text: string; error: boolean }[]>([]);
  readonly confirmReq = signal<{ message: string; ok: string; resolve: (v: boolean) => void } | null>(null);
  readonly addSheetOpen = signal(false);
  private n = 0;

  toast(text: string, error = false) {
    const id = ++this.n;
    this.toasts.update((t) => [...t, { id, text, error }]);
    setTimeout(() => this.toasts.update((t) => t.filter((x) => x.id !== id)), error ? 6000 : 3000);
  }

  error(e: unknown) {
    this.toast(friendlyError(e), true);
  }

  confirm(message: string, ok = 'Delete'): Promise<boolean> {
    return new Promise((resolve) => this.confirmReq.set({ message, ok, resolve }));
  }
}

/**
 * Signal that re-runs an async loader whenever the signals read in `params` change.
 * Stale responses are dropped. Must be called in an injection context.
 */
export function load<P, T>(params: () => P, loader: (p: P) => Promise<T>, initial: T): Signal<T> {
  const ui = inject(Ui);
  const out = signal(initial);
  let seq = 0;
  effect(() => {
    const p = params();
    const mine = ++seq;
    untracked(() => loader(p)).then(
      (v) => mine === seq && out.set(v),
      (e) => ui.error(e),
    );
  });
  return out.asReadonly();
}

/** Save a generated file: share sheet on phones (best for iOS), download link elsewhere. */
export async function shareOrDownload(blob: Blob, filename: string, preferShare: boolean): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });
  if (preferShare && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

@Pipe({ name: 'money', pure: false })
export class MoneyPipe implements PipeTransform {
  transform(minor: number | null | undefined): string {
    return minor == null ? '-' : formatMoney(minor);
  }
}
