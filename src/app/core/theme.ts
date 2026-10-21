import { computed, Injectable, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';

/** Colour choices; light/dark values live in styles.scss ($accents). `swatch` is only for the picker. */
export const ACCENTS = [
  { id: 'indigo', name: 'Indigo', swatch: '#4f46e5' },
  { id: 'teal', name: 'Teal', swatch: '#0d9488' },
  { id: 'emerald', name: 'Emerald', swatch: '#16a34a' },
  { id: 'violet', name: 'Violet', swatch: '#7c3aed' },
  { id: 'rose', name: 'Rose', swatch: '#e11d48' },
  { id: 'amber', name: 'Amber', swatch: '#d97706' },
  { id: 'slate', name: 'Slate', swatch: '#475569' },
  { id: 'dusty', name: 'Dusty gray', swatch: '#a8989b' },
] as const;
export type Accent = (typeof ACCENTS)[number]['id'];

/** Page background choices; values live in styles.scss ($backgrounds). Swatches mirror the light/dark --bg. */
export const BACKGROUNDS = [
  { id: 'default', name: 'Default', light: '#f6f7fb', dark: '#0f1117' },
  { id: 'warm', name: 'Warm', light: '#faf6f0', dark: '#14110d' },
  { id: 'mint', name: 'Mint', light: '#f0f8f4', dark: '#0c1412' },
  { id: 'sky', name: 'Sky', light: '#eef5fb', dark: '#0c121a' },
  { id: 'lavender', name: 'Lavender', light: '#f5f2fb', dark: '#110f19' },
  { id: 'dusty', name: 'Dusty gray', light: '#ece9ea', dark: '#151314' },
  { id: 'plain', name: 'Plain', light: '#ffffff', dark: '#000000' },
] as const;
export type Background = (typeof BACKGROUNDS)[number]['id'];

// Keys are also read by the inline script in index.html to avoid a flash on load.
const MODE_KEY = 'theme';
const ACCENT_KEY = 'accent';
const BG_KEY = 'bg';
const systemQuery = matchMedia('(prefers-color-scheme: dark)');

function read<T extends string>(key: string, allowed: readonly string[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && allowed.includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

/** Light / dark / system preference and colour, kept per device. */
@Injectable({ providedIn: 'root' })
export class Theme {
  readonly mode = signal<ThemeMode>(read(MODE_KEY, ['light', 'dark'], 'system'));
  readonly accent = signal<Accent>(read(ACCENT_KEY, ACCENTS.map((a) => a.id), 'indigo'));
  readonly background = signal<Background>(read(BG_KEY, BACKGROUNDS.map((b) => b.id), 'default'));
  private readonly systemDark = signal(systemQuery.matches);
  readonly dark = computed(() => this.mode() === 'dark' || (this.mode() === 'system' && this.systemDark()));
  /** Resolved theme colours, for canvas charts that can't read CSS variables. */
  readonly colors = computed(() => {
    this.dark();
    this.accent();
    this.background();
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    return { primary: v('--primary'), bg: v('--bg'), surface: v('--surface'), muted: v('--muted'), border: v('--border') };
  });

  constructor() {
    systemQuery.addEventListener('change', (e) => {
      this.systemDark.set(e.matches);
      this.apply();
    });
    this.apply();
  }

  setMode(m: ThemeMode) {
    this.mode.set(m);
    write(MODE_KEY, m === 'system' ? null : m);
    this.apply();
  }

  setAccent(a: Accent) {
    this.accent.set(a);
    write(ACCENT_KEY, a === 'indigo' ? null : a);
    this.apply();
  }

  setBackground(b: Background) {
    this.background.set(b);
    write(BG_KEY, b === 'default' ? null : b);
    this.apply();
  }

  // Applied synchronously so `colors` reads the new CSS values.
  private apply() {
    const d = document.documentElement.dataset;
    const set = (key: string, value: string, fallback: string) => (value === fallback ? delete d[key] : (d[key] = value));
    set('theme', this.mode(), 'system');
    set('accent', this.accent(), 'indigo');
    set('bg', this.background(), 'default');
    const c = this.colors();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', this.dark() ? c.bg : c.primary);
  }
}
