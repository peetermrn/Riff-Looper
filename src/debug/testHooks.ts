/**
 * Hooks for the automated browser tests (e2e/). Exposed as `window.__practice`.
 * Harmless in normal use: nothing here runs unless a test calls it.
 *
 * The capture taps the song bus and the click bus separately (as two channels)
 * with an AudioWorklet, so tests can check on the real audio output that
 * clicks and song beats line up, and that loops have no gaps.
 */
import type { App } from '../app';
import type { WaveformView } from '../waveform/WaveformView';
import { detectOnsets, estimateFrequency } from './onsets';

const RECORDER_SRC = `
class Recorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.a = []; this.b = []; this.first = -1; this.on = false;
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.a = []; this.b = []; this.first = -1; this.on = true; }
      if (e.data === 'stop') {
        this.on = false;
        this.port.postMessage({ first: this.first, a: this.a, b: this.b });
        this.a = []; this.b = [];
      }
    };
  }
  process(inputs) {
    if (!this.on) return true;
    if (this.first < 0) this.first = currentFrame;
    const inp = inputs[0] || [];
    this.a.push(inp[0] ? new Float32Array(inp[0]) : new Float32Array(128));
    this.b.push(inp[1] ? new Float32Array(inp[1]) : new Float32Array(128));
    return true;
  }
}
registerProcessor('test-recorder', Recorder);
`;

interface Capture {
  sampleRate: number;
  /** ctx time of the first captured sample */
  startTime: number;
  song: Float32Array;
  click: Float32Array;
}

export function installTestHooks(app: App, view: WaveformView): void {
  let recorder: AudioWorkletNode | null = null;
  let last: Capture | null = null;

  async function ensureRecorder(): Promise<AudioWorkletNode> {
    const p = app.player!;
    if (recorder) return recorder;
    const ctx = p.ctx;
    const url = URL.createObjectURL(new Blob([RECORDER_SRC], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    const mono = (src: AudioNode) => {
      const g = new GainNode(ctx, { channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
      src.connect(g);
      return g;
    };
    const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    mono(p.songBus).connect(merger, 0, 0);
    mono(p.clickBus).connect(merger, 0, 1);
    recorder = new AudioWorkletNode(ctx, 'test-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    merger.connect(recorder);
    const silent = new GainNode(ctx, { gain: 0 });
    recorder.connect(silent).connect(ctx.destination);
    return recorder;
  }

  const hooks = {
    app,
    view,
    /** Which decoder was used for the loaded song. */
    decoder: () => app.state.song?.decoder ?? null,
    duration: () => app.state.song?.duration ?? null,
    /** Onset times (s) in the decoded original audio. */
    originalOnsets(): number[] {
      const b = app.original!;
      return detectOnsets(b.getChannelData(0), b.sampleRate).map((i) => i / b.sampleRate);
    },
    /** Info about the buffer currently used for playback. */
    playBufferInfo() {
      const p = app.player!;
      const b = p.currentBuffer!;
      return { duration: b.duration, speed: p.currentSpeed, sampleRate: b.sampleRate };
    },
    /** Dominant frequency of the playback buffer between t0 and t1 (buffer seconds). */
    playBufferFrequency(t0: number, t1: number): number {
      const b = app.player!.currentBuffer!;
      const x = b.getChannelData(0).subarray(Math.round(t0 * b.sampleRate), Math.round(t1 * b.sampleRate));
      return estimateFrequency(x, b.sampleRate);
    },
    async startCapture(): Promise<void> {
      const r = await ensureRecorder();
      r.port.postMessage('start');
    },
    async stopCapture(): Promise<{ startTime: number; seconds: number; sampleRate: number }> {
      const r = await ensureRecorder();
      const sr = app.player!.ctx.sampleRate;
      const data = await new Promise<{ first: number; a: Float32Array[]; b: Float32Array[] }>((resolve) => {
        r.port.onmessage = (e) => resolve(e.data);
        r.port.postMessage('stop');
      });
      const join = (chunks: Float32Array[]) => {
        const out = new Float32Array(chunks.length * 128);
        chunks.forEach((c, i) => out.set(c, i * 128));
        return out;
      };
      last = { sampleRate: sr, startTime: data.first / sr, song: join(data.a), click: join(data.b) };
      return { startTime: last.startTime, seconds: last.song.length / sr, sampleRate: sr };
    },
    /** Onsets (ctx seconds) found in the last capture, for song and click channels separately. */
    captureOnsets(thresholdRatio = 0.25) {
      const c = last!;
      const toTime = (i: number) => c.startTime + i / c.sampleRate;
      return {
        song: detectOnsets(c.song, c.sampleRate, { thresholdRatio, absThreshold: 0.05 }).map(toTime),
        click: detectOnsets(c.click, c.sampleRate, { thresholdRatio, absThreshold: 0.05 }).map(toTime),
      };
    },
    /** RMS of the song channel in consecutive windows (for gap detection). */
    captureRms(windowSec = 0.01): number[] {
      const c = last!;
      const n = Math.round(windowSec * c.sampleRate);
      const out: number[] = [];
      for (let i = 0; i + n <= c.song.length; i += n) {
        let e = 0;
        for (let j = i; j < i + n; j++) e += c.song[j] * c.song[j];
        out.push(Math.sqrt(e / n));
      }
      return out;
    },
    ctxTime: () => app.player?.ctx.currentTime ?? 0,
  };
  (window as unknown as { __practice: typeof hooks }).__practice = hooks;
}
