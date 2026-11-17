/**
 * Waveform peak data: min/max sample values over time ranges, used to draw
 * the waveform at any zoom level quickly.
 */
const BUCKET = 256; // samples per precomputed bucket

export class Peaks {
  readonly duration: number;
  private readonly sampleRate: number;
  private readonly channels: Float32Array[];
  private readonly min: Float32Array;
  private readonly max: Float32Array;

  constructor(buffer: AudioBuffer) {
    this.sampleRate = buffer.sampleRate;
    this.duration = buffer.duration;
    this.channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    const n = Math.ceil(buffer.length / BUCKET);
    this.min = new Float32Array(n);
    this.max = new Float32Array(n);
    for (let b = 0; b < n; b++) {
      const [lo, hi] = this.rawRange(b * BUCKET, Math.min(buffer.length, (b + 1) * BUCKET));
      this.min[b] = lo;
      this.max[b] = hi;
    }
  }

  /** [min, max] of the signal between t0 and t1 (seconds). */
  range(t0: number, t1: number): [number, number] {
    const s0 = Math.max(0, Math.floor(t0 * this.sampleRate));
    const s1 = Math.min(this.channels[0].length, Math.ceil(t1 * this.sampleRate));
    if (s1 <= s0) return [0, 0];
    if (s1 - s0 < BUCKET * 4) return this.rawRange(s0, s1);
    let lo = 0;
    let hi = 0;
    const b1 = Math.min(this.min.length, Math.ceil(s1 / BUCKET));
    for (let b = Math.floor(s0 / BUCKET); b < b1; b++) {
      if (this.min[b] < lo) lo = this.min[b];
      if (this.max[b] > hi) hi = this.max[b];
    }
    return [lo, hi];
  }

  private rawRange(s0: number, s1: number): [number, number] {
    let lo = 0;
    let hi = 0;
    for (const ch of this.channels) {
      for (let i = s0; i < s1; i++) {
        const v = ch[i];
        if (v < lo) lo = v;
        else if (v > hi) hi = v;
      }
    }
    return [lo, hi];
  }
}
