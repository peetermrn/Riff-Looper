import { describe, expect, it } from 'vitest';
import { wsolaStretch } from '../src/audio/timeStretch/wsola';
import { detectOnsets, estimateFrequency } from '../src/debug/onsets';

const SR = 48000;

function run<T>(gen: Generator<number, T, void>): T {
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}

/** Click track: decaying 1 kHz blips every `beat` seconds starting at `first`. */
function clickTrack(seconds: number, first = 0.25, beat = 0.5): Float32Array {
  const x = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    if (t < first) continue;
    const since = (t - first) % beat;
    x[i] = 0.8 * Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-since * 300);
  }
  return x;
}

function sine(seconds: number, freq: number): Float32Array {
  const x = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / SR);
  return x;
}

describe('wsolaStretch', () => {
  it('returns an identical copy at speed 1', () => {
    const x = sine(1, 440);
    const [y] = run(wsolaStretch([x], SR, 1));
    expect(y).toEqual(x);
  });

  it.each([0.7, 0.8, 0.9])('keeps click timing aligned (no drift) at speed %s', (speed) => {
    const x = clickTrack(30);
    const [y] = run(wsolaStretch([x, x], SR, speed));
    expect(y.length).toBe(Math.round(x.length / speed));
    const onsets = detectOnsets(y, SR);
    expect(onsets.length).toBe(60); // every click reproduced exactly once (no ghost copies)
    const errorsMs = onsets.map((o, n) => (o / SR - (0.25 + n * 0.5) / speed) * 1000);
    // Onset anchoring keeps hits within the 4 ms tolerance, start to end (no drift).
    expect(Math.max(...errorsMs.map(Math.abs))).toBeLessThan(4.5);
  });

  it('keeps drum hits on time over a sustained bass note', () => {
    // 55 Hz bass + short 3 kHz "hits" every 0.5 s from 0.25 s.
    const x = new Float32Array(20 * SR);
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      x[i] = 0.4 * Math.sin(2 * Math.PI * 55 * t);
      if (t >= 0.25) x[i] += 0.5 * Math.sin(2 * Math.PI * 3000 * t) * Math.exp(-((t - 0.25) % 0.5) * 400);
    }
    const speed = 0.75;
    const [y] = run(wsolaStretch([x], SR, speed));
    const hp = y.map((v, i) => (i > 0 ? v - y[i - 1] : 0)); // high-pass to see the hits
    const onsets = detectOnsets(hp, SR, { thresholdRatio: 0.3, quietSec: 0.05 });
    for (let n = 0; n < 35; n++) {
      const nominal = ((0.25 + n * 0.5) / speed) * SR;
      const nearest = Math.min(...onsets.map((o) => Math.abs(o - nominal)));
      expect((nearest / SR) * 1000).toBeLessThan(4.5);
    }
  });

  it('preserves pitch when slowing down', () => {
    const x = sine(4, 440);
    const [y] = run(wsolaStretch([x], SR, 0.7));
    const mid = y.subarray(SR, 4 * SR);
    expect(estimateFrequency(mid, SR)).toBeCloseTo(440, 0);
    // Level should stay steady (no big dips at frame joins).
    let min = Infinity;
    let max = 0;
    for (let i = SR; i < 4 * SR; i += 960) {
      let e = 0;
      for (let j = 0; j < 960; j++) e += y[i + j] ** 2;
      const rms = Math.sqrt(e / 960);
      min = Math.min(min, rms);
      max = Math.max(max, rms);
    }
    expect(min / max).toBeGreaterThan(0.9);
  });

  it('is fast enough for whole songs', () => {
    const x = sine(60, 110);
    const t0 = performance.now();
    run(wsolaStretch([x, x], SR, 0.7));
    const ms = performance.now() - t0;
    console.log(`60 s stereo @48k -> 0.7x took ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(5000);
  });
});
