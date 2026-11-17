/**
 * The zoomable main waveform (canvas).
 *
 * Shows: waveform, beat grid, sections (with name labels), the current
 * selection, loop region and playhead.
 *
 * Mouse/touch:
 *  - click            -> seek
 *  - drag             -> select a range (then "Add section")
 *  - drag a section edge (in the label strip or the waveform) -> resize it
 *  - click a section label -> make it the active section
 *  - wheel / trackpad -> scroll; Ctrl/Cmd + wheel -> zoom at the cursor
 */
import { ZOOM } from '../config';
import { sectionColor } from '../sections/sections';
import type { Section, Selection } from '../state/types';
import { Peaks } from './peaks';
import { readTheme, type CanvasTheme } from './theme';

export interface WaveformCallbacks {
  onSeek(time: number): void;
  onSelect(sel: Selection | null, done: boolean): void;
  onResizeSection(id: string, edge: 'start' | 'end', time: number, done: boolean): void;
  onActivateSection(id: string): void;
  /** Called whenever zoom/scroll changes (to update the overview). */
  onViewChange(): void;
}

export interface WaveformData {
  sections: Section[];
  activeSectionId: string | null;
  selection: Selection | null;
  loopRegion: Selection | null;
  bpm: number | null;
  beatOffset: number;
  beatsPerBar: number;
}

const LABEL_H = 22; // height of the section label strip, CSS px
const EDGE_GRAB_PX = 7;
const DRAG_THRESHOLD_PX = 4;

type Drag =
  | { kind: 'pending'; x: number; time: number; pointerId: number; inLabels: boolean }
  | { kind: 'select'; anchor: number; pointerId: number }
  | { kind: 'resize'; id: string; edge: 'start' | 'end'; pointerId: number };

export class WaveformView {
  readonly canvas: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;
  private peaks: Peaks | null = null;
  private duration = 0;
  private data: WaveformData = {
    sections: [],
    activeSectionId: null,
    selection: null,
    loopRegion: null,
    bpm: null,
    beatOffset: 0,
    beatsPerBar: 4,
  };
  private playhead = 0;
  private width = 0; // CSS px
  private height = 0;
  private pxPerSec = 50;
  private viewStart = 0; // seconds at the left edge
  private drag: Drag | null = null;
  private lastUserScroll = 0;
  private theme: CanvasTheme;
  private frame = 0;

  constructor(
    private container: HTMLElement,
    private cb: WaveformCallbacks,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'waveform-canvas';
    this.canvas.setAttribute('aria-label', 'Waveform: click to seek, drag to select');
    container.appendChild(this.canvas);
    this.ctx2d = this.canvas.getContext('2d')!;
    this.theme = readTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      this.theme = readTheme();
      this.invalidate();
    });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.attachEvents();
  }

  // ------------------------------------------------------------ public API

  setAudio(buffer: AudioBuffer | null): void {
    this.peaks = buffer ? new Peaks(buffer) : null;
    this.duration = buffer?.duration ?? 0;
    this.zoomFit();
  }

  setData(data: WaveformData): void {
    this.data = data;
    this.invalidate();
  }

  setPlayhead(time: number, follow: boolean): void {
    if (time === this.playhead) return;
    this.playhead = time;
    if (follow && performance.now() - this.lastUserScroll > 2500) this.keepVisible(time);
    this.invalidate();
  }

  get view(): { start: number; end: number } {
    return { start: this.viewStart, end: this.viewStart + this.width / this.pxPerSec };
  }

  get isZoomedOut(): boolean {
    return this.pxPerSec <= this.fitPxPerSec() + 1e-9;
  }

  zoomIn(): void {
    this.zoomAround(ZOOM.step, this.zoomAnchor());
  }

  zoomOut(): void {
    this.zoomAround(1 / ZOOM.step, this.zoomAnchor());
  }

  zoomFit(): void {
    this.pxPerSec = this.fitPxPerSec();
    this.viewStart = 0;
    this.changed();
  }

  /** Scroll so the view starts at `start` seconds. */
  scrollTo(start: number): void {
    const visible = this.width / this.pxPerSec;
    this.viewStart = Math.max(0, Math.min(start, Math.max(0, this.duration - visible)));
    this.changed();
  }

  /** Scroll so `time` is in the middle of the view. */
  centerOn(time: number): void {
    this.scrollTo(time - this.width / this.pxPerSec / 2);
  }

  // ------------------------------------------------------------ geometry

  private fitPxPerSec(): number {
    return this.duration > 0 ? Math.max(1e-3, this.width / this.duration) : 50;
  }

  private xOf(t: number): number {
    return (t - this.viewStart) * this.pxPerSec;
  }

  private timeOf(x: number): number {
    return Math.max(0, Math.min(this.duration, this.viewStart + x / this.pxPerSec));
  }

  private zoomAnchor(): number {
    // Zoom around the playhead if it's visible, otherwise the view centre.
    const v = this.view;
    return this.playhead >= v.start && this.playhead <= v.end ? this.playhead : (v.start + v.end) / 2;
  }

  private zoomAround(factor: number, anchorTime: number): void {
    const x = this.xOf(anchorTime);
    this.pxPerSec = Math.max(this.fitPxPerSec(), Math.min(ZOOM.maxPxPerSec, this.pxPerSec * factor));
    this.lastUserScroll = performance.now();
    this.scrollTo(anchorTime - x / this.pxPerSec);
  }

  private keepVisible(time: number): void {
    const v = this.view;
    const span = v.end - v.start;
    if (time < v.start || time > v.end - span * 0.05) this.scrollTo(time - span * 0.1);
  }

  private resize(): void {
    const r = this.container.getBoundingClientRect();
    const wasFit = this.isZoomedOut;
    this.width = Math.max(1, Math.floor(r.width));
    this.height = Math.max(1, Math.floor(r.height));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    if (wasFit) this.pxPerSec = this.fitPxPerSec();
    else this.pxPerSec = Math.max(this.fitPxPerSec(), this.pxPerSec);
    this.scrollTo(this.viewStart);
  }

  private changed(): void {
    this.invalidate();
    this.cb.onViewChange();
  }

  // ------------------------------------------------------------ drawing

  private invalidate(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const g = this.ctx2d;
    const dpr = window.devicePixelRatio || 1;
    const { width: W, height: H, theme: c } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = c.bg;
    g.fillRect(0, 0, W, H);
    if (!this.peaks) return;

    const waveTop = LABEL_H;
    const waveH = H - LABEL_H;
    const mid = waveTop + waveH / 2;
    g.fillStyle = c.labelStrip;
    g.fillRect(0, 0, W, LABEL_H);

    // Sections (sorted by start, colour by index)
    this.data.sections.forEach((s, i) => {
      const x0 = this.xOf(s.start);
      const x1 = this.xOf(s.end);
      if (x1 < 0 || x0 > W) return;
      const active = s.id === this.data.activeSectionId;
      const col = sectionColor(i);
      g.globalAlpha = active ? 0.28 : 0.13;
      g.fillStyle = col;
      g.fillRect(x0, waveTop, x1 - x0, waveH);
      g.globalAlpha = 1;
      g.fillStyle = col;
      g.fillRect(x0, 0, x1 - x0, LABEL_H);
      g.fillRect(x0, waveTop, active ? 2 : 1, waveH);
      g.fillRect(x1 - (active ? 2 : 1), waveTop, active ? 2 : 1, waveH);
      // label
      g.save();
      g.beginPath();
      g.rect(x0, 0, x1 - x0, LABEL_H);
      g.clip();
      g.fillStyle = '#fff';
      g.font = `${active ? '600 ' : ''}13px system-ui, sans-serif`;
      g.textBaseline = 'middle';
      g.fillText(s.name, Math.max(x0, 0) + 6, LABEL_H / 2 + 1);
      g.restore();
    });

    // Loop region outline
    const loop = this.data.loopRegion;
    if (loop) {
      const x0 = this.xOf(loop.start);
      const x1 = this.xOf(loop.end);
      g.strokeStyle = c.loop;
      g.lineWidth = 2;
      g.setLineDash([6, 4]);
      g.strokeRect(x0 + 1, waveTop + 1, x1 - x0 - 2, waveH - 2);
      g.setLineDash([]);
    }

    // Selection
    const sel = this.data.selection;
    if (sel) {
      const x0 = this.xOf(sel.start);
      const x1 = this.xOf(sel.end);
      g.fillStyle = c.selection;
      g.fillRect(x0, waveTop, x1 - x0, waveH);
      g.fillStyle = c.selectionEdge;
      g.fillRect(x0 - 1, waveTop, 2, waveH);
      g.fillRect(x1 - 1, waveTop, 2, waveH);
    }

    this.drawBeatGrid(waveTop, waveH);

    // Waveform: one min/max bar per pixel column
    g.fillStyle = c.wave;
    const secPerPx = 1 / this.pxPerSec;
    for (let x = 0; x < W; x++) {
      const t0 = this.viewStart + x * secPerPx;
      if (t0 > this.duration) break;
      const [lo, hi] = this.peaks.range(t0, t0 + secPerPx);
      const y0 = mid - hi * (waveH / 2) * 0.95;
      const y1 = mid - lo * (waveH / 2) * 0.95;
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }

    // Playhead
    const px = this.xOf(this.playhead);
    if (px >= -2 && px <= W + 2) {
      g.fillStyle = c.playhead;
      g.fillRect(Math.round(px) - 1, 0, 2, H);
    }
  }

  private drawBeatGrid(top: number, h: number): void {
    const { bpm, beatOffset, beatsPerBar } = this.data;
    if (!bpm) return;
    const beat = 60 / bpm;
    const beatPx = beat * this.pxPerSec;
    const showBeats = beatPx >= 8;
    const showBars = beatPx * beatsPerBar >= 6;
    if (!showBars) return;
    const g = this.ctx2d;
    const v = this.view;
    const first = Math.ceil((v.start - beatOffset) / beat);
    const last = Math.floor((Math.min(v.end, this.duration) - beatOffset) / beat);
    for (let n = first; n <= last; n++) {
      const isBar = ((n % beatsPerBar) + beatsPerBar) % beatsPerBar === 0;
      if (!isBar && !showBeats) continue;
      const x = Math.round(this.xOf(beatOffset + n * beat));
      g.fillStyle = isBar ? this.theme.bar : this.theme.beat;
      g.fillRect(x, top, 1, h);
    }
  }

  // ------------------------------------------------------------ interaction

  private attachEvents(): void {
    const el = this.canvas;
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('pointercancel', () => (this.drag = null));
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  private localX(e: PointerEvent | WheelEvent): number {
    return e.clientX - this.canvas.getBoundingClientRect().left;
  }

  /** A section edge near x (prefers the active section), or null. */
  private edgeAt(x: number): { id: string; edge: 'start' | 'end' } | null {
    let best: { id: string; edge: 'start' | 'end'; d: number } | null = null;
    for (const s of this.data.sections) {
      for (const edge of ['start', 'end'] as const) {
        const d = Math.abs(this.xOf(s[edge]) - x);
        const bonus = s.id === this.data.activeSectionId ? 0.5 : 0;
        if (d <= EDGE_GRAB_PX && (!best || d - bonus < best.d)) best = { id: s.id, edge, d: d - bonus };
      }
    }
    return best;
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.peaks || e.button !== 0) return;
    const x = this.localX(e);
    const y = e.clientY - this.canvas.getBoundingClientRect().top;
    this.canvas.setPointerCapture(e.pointerId);
    const edge = this.edgeAt(x);
    if (edge) {
      this.drag = { kind: 'resize', id: edge.id, edge: edge.edge, pointerId: e.pointerId };
      return;
    }
    this.drag = { kind: 'pending', x, time: this.timeOf(x), pointerId: e.pointerId, inLabels: y < LABEL_H };
  }

  private onPointerMove(e: PointerEvent): void {
    const x = this.localX(e);
    const d = this.drag;
    if (!d) {
      this.canvas.style.cursor = this.edgeAt(x) ? 'ew-resize' : 'crosshair';
      return;
    }
    if (d.kind === 'pending' && Math.abs(x - d.x) > DRAG_THRESHOLD_PX) {
      this.drag = { kind: 'select', anchor: d.time, pointerId: d.pointerId };
    }
    const cur = this.drag!;
    if (cur.kind === 'select') {
      const t = this.timeOf(x);
      this.cb.onSelect({ start: Math.min(cur.anchor, t), end: Math.max(cur.anchor, t) }, false);
    } else if (cur.kind === 'resize') {
      this.cb.onResizeSection(cur.id, cur.edge, this.timeOf(x), false);
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const x = this.localX(e);
    if (d.kind === 'pending') {
      const section = d.inLabels
        ? this.data.sections.find((s) => d.time >= s.start && d.time <= s.end)
        : undefined;
      if (section) this.cb.onActivateSection(section.id);
      else {
        this.cb.onSelect(null, true);
        this.cb.onSeek(d.time);
      }
    } else if (d.kind === 'select') {
      const t = this.timeOf(x);
      this.cb.onSelect({ start: Math.min(d.anchor, t), end: Math.max(d.anchor, t) }, true);
    } else {
      this.cb.onResizeSection(d.id, d.edge, this.timeOf(x), true);
    }
  }

  private onWheel(e: WheelEvent): void {
    if (!this.peaks) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.width : 1; // lines/pages -> px
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp((-e.deltaY * unit) / 300);
      this.zoomAround(factor, this.timeOf(this.localX(e)));
      return;
    }
    const dx = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
    this.lastUserScroll = performance.now();
    this.scrollTo(this.viewStart + dx / this.pxPerSec);
  }
}
