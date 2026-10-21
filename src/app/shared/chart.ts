import { Component, DestroyRef, effect, ElementRef, inject, input, viewChild } from '@angular/core';
import { Theme } from '../core/theme';
import Chart, { ChartConfiguration } from 'chart.js/auto';

Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font') || 'system-ui';

@Component({
  selector: 'app-chart',
  template: `<div class="chart-box"><canvas #c role="img" [attr.aria-label]="label()"></canvas></div>`,
})
export class ChartView {
  readonly config = input.required<ChartConfiguration>();
  readonly label = input('Chart');
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('c');
  private chart?: Chart;
  private readonly theme = inject(Theme);

  constructor() {
    effect(() => {
      const cfg = this.config();
      const t = this.theme.colors();
      Chart.defaults.color = t.muted;
      Chart.defaults.borderColor = t.border;
      Chart.defaults.elements.arc.borderColor = t.surface;
      this.chart?.destroy();
      this.chart = new Chart(this.canvas().nativeElement, {
        ...cfg,
        options: { responsive: true, maintainAspectRatio: false, animation: false, ...cfg.options },
      });
    });
    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }
}

/** Category colours, led by the user's chosen brand colour. */
export const palette = (brand: string) => [brand, '#4f46e5', '#0ea5e9', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b', '#22c55e', '#ec4899'];
