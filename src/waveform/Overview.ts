/**
 * The small whole-song strip above the main waveform. Always shows the full
 * song, the sections, the playhead and which part the main view shows.
 * Click to jump there; drag to scroll the main view.
 */
import { sectionColor } from '../sections/sections';
import type { Section } from '../state/types';
import { Peaks } from './peaks';
import { readTheme, type CanvasTheme } from './theme';

export interface OverviewCallbacks {
  onSeek(time: number): void;
  onScroll(centerTime: number): void;
}

export class Overview {
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private columns: Float32Array = new Float32Array(0); // [lo, hi] per pixel column
  private peaks: Peaks | null = null;
  private duration = 0;
  private width = 0;
  private height = 0;
  private sections: Section[] = [];
  private view = { start: 0, end: 0 };
  private playhead = 0;
  private theme: CanvasTheme = readTheme();
  private frame = 0;
  private dragging: { x: number; moved: boolean } | null = null;

  constructor(
    private container: HTMLElement,
    private cb: OverviewCallbacks,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'overview-canvas';
    container.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(container);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      this.theme = readTheme();
      this.invalidate();
    });
    this.resize();
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.peaks) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.dragging = { x: e.clientX, moved: false };
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      if (Math.abs(e.clientX - this.dragging.x) > 3) this.dragging.moved = true;
      if (this.dragging.moved) this.cb.onScroll(this.timeAt(e.clientX));
    });
    this.canvas.addEventListener('pointerup', (e) => {
      const d = this.dragging;
      this.dragging = null;
      if (!d) return;
      if (!d.moved) {
        this.cb.onSeek(this.timeAt(e.clientX));
        this.cb.onScroll(this.timeAt(e.clientX));
      }
    });
  }

  setAudio(buffer: AudioBuffer | null): void {
    this.peaks = buffer ? new Peaks(buffer) : null;
    this.duration = buffer?.duration ?? 0;
    this.computeColumns();
    this.invalidate();
  }

  update(sections: Section[], view: { start: number; end: number }, playhead: number): void {
    this.sections = sections;
    this.view = view;
    this.playhead = playhead;
    this.invalidate();
  }

  private timeAt(clientX: number): number {
    const x = clientX - this.canvas.getBoundingClientRect().left;
    return Math.max(0, Math.min(this.duration, (x / this.width) * this.duration));
  }

  private resize(): void {
    const r = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.floor(r.width));
    this.height = Math.max(1, Math.floor(r.height));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.computeColumns();
    this.invalidate();
  }

  private computeColumns(): void {
    this.columns = new Float32Array(this.width * 2);
    if (!this.peaks) return;
    const step = this.duration / this.width;
    for (let x = 0; x < this.width; x++) {
      const [lo, hi] = this.peaks.range(x * step, (x + 1) * step);
      this.columns[2 * x] = lo;
      this.columns[2 * x + 1] = hi;
    }
  }

  private invalidate(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const g = this.g;
    const dpr = window.devicePixelRatio || 1;
    const { width: W, height: H, theme: c } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = c.bg;
    g.fillRect(0, 0, W, H);
    if (!this.peaks || this.duration <= 0) return;
    const xOf = (t: number) => (t / this.duration) * W;

    this.sections.forEach((s, i) => {
      g.fillStyle = sectionColor(i);
      g.globalAlpha = 0.35;
      g.fillRect(xOf(s.start), 0, xOf(s.end) - xOf(s.start), H);
      g.globalAlpha = 1;
      g.fillRect(xOf(s.start), H - 4, xOf(s.end) - xOf(s.start), 4);
    });

    g.fillStyle = c.wave;
    const mid = H / 2;
    for (let x = 0; x < W; x++) {
      const lo = this.columns[2 * x];
      const hi = this.columns[2 * x + 1];
      const y0 = mid - hi * mid * 0.9;
      g.fillRect(x, y0, 1, Math.max(1, mid - lo * mid * 0.9 - y0));
    }

    // Visible part of the main view
    const v0 = xOf(this.view.start);
    const v1 = xOf(this.view.end);
    if (v1 - v0 < W - 1) {
      g.fillStyle = c.viewport;
      g.fillRect(v0, 0, Math.max(2, v1 - v0), H);
      g.strokeStyle = c.selectionEdge;
      g.lineWidth = 1;
      g.strokeRect(v0 + 0.5, 0.5, Math.max(2, v1 - v0) - 1, H - 1);
    }

    g.fillStyle = c.playhead;
    g.fillRect(Math.round(xOf(this.playhead)) - 1, 0, 2, H);
  }
}
