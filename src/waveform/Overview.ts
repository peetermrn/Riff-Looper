/**
 * The small whole-song strip above the main waveform. Always shows the full
 * song, the sections, the playhead and which part the main view shows (the
 * highlighted "viewport" box). It doubles as a zoom bar, like Premiere's:
 *  - drag the box's left/right edge -> zoom (that edge moves, the other stays)
 *  - drag inside the box            -> pan
 *  - click outside the box          -> jump there; drag outside -> pan to there
 *  - mouse wheel                    -> zoom around the mouse; Shift + wheel -> pan
 */
import { sectionColor } from '../sections/sections';
import type { Section } from '../state/types';
import { Peaks } from './peaks';
import { readTheme, type CanvasTheme } from './theme';

export interface OverviewCallbacks {
  onSeek(time: number): void;
  /** Centre the main view on this time. */
  onScroll(centerTime: number): void;
  /** Show exactly [start, end] in the main view. */
  onSetView(start: number, end: number): void;
  /** Zoom the main view by `factor` (>1 = in) around `time`. */
  onZoom(factor: number, time: number): void;
}

const EDGE_GRAB_PX = 8;

type OverviewDrag =
  | { kind: 'outside'; x: number; moved: boolean }
  | { kind: 'move'; x: number; start: number; end: number; moved: boolean }
  | { kind: 'left' }
  | { kind: 'right' };

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
  private dragging: OverviewDrag | null = null;

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
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointercancel', () => (this.dragging = null));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  // ------------------------------------------------------------ interaction

  private localX(e: MouseEvent): number {
    return e.clientX - this.canvas.getBoundingClientRect().left;
  }

  private xOf(t: number): number {
    return this.duration > 0 ? (t / this.duration) * this.width : 0;
  }

  /** What is under pixel x: a viewport edge, the viewport body, or outside it. */
  private hit(x: number): 'left' | 'right' | 'inside' | 'outside' {
    const v0 = this.xOf(this.view.start);
    const v1 = this.xOf(this.view.end);
    const dl = Math.abs(x - v0);
    const dr = Math.abs(x - v1);
    if (Math.min(dl, dr) <= EDGE_GRAB_PX) return dl < dr ? 'left' : 'right';
    return x > v0 && x < v1 ? 'inside' : 'outside';
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.peaks || e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    const x = this.localX(e);
    const h = this.hit(x);
    if (h === 'left') this.dragging = { kind: 'left' };
    else if (h === 'right') this.dragging = { kind: 'right' };
    else if (h === 'inside') this.dragging = { kind: 'move', x, start: this.view.start, end: this.view.end, moved: false };
    else this.dragging = { kind: 'outside', x, moved: false };
  }

  private onPointerMove(e: PointerEvent): void {
    const x = this.localX(e);
    const d = this.dragging;
    if (!d) {
      const h = this.hit(x);
      this.canvas.style.cursor = h === 'left' || h === 'right' ? 'ew-resize' : h === 'inside' ? 'grab' : 'pointer';
      return;
    }
    const t = this.timeAt(e.clientX);
    if (d.kind === 'left' || d.kind === 'right') {
      if (d.kind === 'left') this.cb.onSetView(Math.min(t, this.view.end - 0.01), this.view.end);
      else this.cb.onSetView(this.view.start, Math.max(t, this.view.start + 0.01));
    } else {
      if (Math.abs(x - d.x) > 3) d.moved = true;
      if (!d.moved) return;
      if (d.kind === 'move') {
        const shift = ((x - d.x) / this.width) * this.duration;
        this.canvas.style.cursor = 'grabbing';
        this.cb.onSetView(d.start + shift, d.end + shift);
      } else {
        this.cb.onScroll(t);
      }
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.dragging;
    this.dragging = null;
    this.canvas.style.cursor = '';
    if (!d) return;
    // A plain click (no drag) jumps there and brings it into view.
    if ((d.kind === 'outside' || d.kind === 'move') && !d.moved) {
      const t = this.timeAt(e.clientX);
      this.cb.onSeek(t);
      if (d.kind === 'outside') this.cb.onScroll(t);
    }
  }

  private onWheel(e: WheelEvent): void {
    if (!this.peaks) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.width : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (e.shiftKey || Math.abs(dx) > Math.abs(dy)) {
      // Pan: 1 px of wheel moves the viewport box by 1 px.
      const shift = ((Math.abs(dx) > Math.abs(dy) ? dx : dy) / this.width) * this.duration;
      this.cb.onSetView(this.view.start + shift, this.view.end + shift);
      return;
    }
    this.cb.onZoom(Math.exp(-dy / 380), this.timeAt(e.clientX));
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

    // Visible part of the main view (the zoom bar's draggable box, with edge grips)
    const v0 = xOf(this.view.start);
    const v1 = Math.max(v0 + 2, xOf(this.view.end));
    g.fillStyle = c.viewport;
    g.fillRect(v0, 0, v1 - v0, H);
    g.strokeStyle = c.selectionEdge;
    g.lineWidth = 1;
    g.strokeRect(v0 + 0.5, 0.5, v1 - v0 - 1, H - 1);
    g.fillStyle = c.selectionEdge;
    for (const x of [v0, v1 - 4]) g.fillRect(x, H * 0.25, 4, H * 0.5);

    g.fillStyle = c.playhead;
    g.fillRect(Math.round(xOf(this.playhead)) - 1, 0, 2, H);
  }
}
