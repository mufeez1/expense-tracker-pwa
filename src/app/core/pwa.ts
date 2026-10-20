import { inject, Injectable, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

@Injectable({ providedIn: 'root' })
export class Pwa {
  readonly online = signal(navigator.onLine);
  readonly updateReady = signal(false);
  readonly canPrompt = signal(false);
  readonly isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  readonly isAndroid = /android/i.test(navigator.userAgent);
  readonly standalone =
    matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  private promptEvent?: InstallPromptEvent;

  constructor() {
    addEventListener('online', () => this.online.set(true));
    addEventListener('offline', () => this.online.set(false));
    addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.promptEvent = e as InstallPromptEvent;
      this.canPrompt.set(true);
    });
    const sw = inject(SwUpdate);
    if (sw.isEnabled) {
      sw.versionUpdates.pipe(filter((e) => e.type === 'VERSION_READY')).subscribe(() => this.updateReady.set(true));
      sw.unrecoverable.subscribe(() => this.updateReady.set(true));
    }
  }

  async install() {
    if (!this.promptEvent) return;
    await this.promptEvent.prompt();
    await this.promptEvent.userChoice;
    this.promptEvent = undefined;
    this.canPrompt.set(false);
  }

  reload() {
    location.reload();
  }

  /** Asks the browser not to evict our IndexedDB under storage pressure. */
  async persist(): Promise<boolean> {
    return (await navigator.storage?.persist?.()) ?? false;
  }

  async storageInfo() {
    const [persisted, est] = await Promise.all([navigator.storage?.persisted?.() ?? false, navigator.storage?.estimate?.()]);
    return { persisted, usage: est?.usage, quota: est?.quota };
  }
}
