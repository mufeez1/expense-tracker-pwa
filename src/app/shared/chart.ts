import { Component, DestroyRef, effect, ElementRef, inject, input, viewChild } from '@angular/core';
import Chart, { ChartConfiguration } from 'chart.js/auto';

Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font') || 'system-ui';
Chart.defaults.color = '#64748b';

@Component({
  selector: 'app-chart',
  template: `<div class="chart-box"><canvas #c role="img" [attr.aria-label]="label()"></canvas></div>`,
})
export class ChartView {
  readonly config = input.required<ChartConfiguration>();
  readonly label = input('Chart');
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('c');
  private chart?: Chart;

  constructor() {
    effect(() => {
      const cfg = this.config();
      this.chart?.destroy();
      this.chart = new Chart(this.canvas().nativeElement, {
        ...cfg,
        options: { responsive: true, maintainAspectRatio: false, animation: false, ...cfg.options },
      });
    });
    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }
}

export const PALETTE = ['#1e2a63', '#4f46e5', '#0ea5e9', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b', '#22c55e', '#ec4899'];
