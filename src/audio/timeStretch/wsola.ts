/**
 * WSOLA time-stretching (Waveform Similarity Overlap-Add) with onset anchoring.
 *
 * Changes the tempo of audio without changing its pitch. Pure functions, no DOM
 * or Web Audio, so it runs inside a Worker and in unit tests.
 *
 * How it works, in short:
 *  - The output is built from overlapping, Hann-windowed frames of length N,
 *    placed every H = N/2 output samples (50% overlap -> windows sum to 1).
 *  - Output frame k is centred at output sample c = k*H. Its "nominal" source
 *    position is c*speed (that is what makes the result slower/faster).
 *  - Normally we may shift the source position by up to ±SEARCH samples to
 *    find the spot that best continues the previous frame's waveform (highest
 *    correlation). This avoids phasey/garbled joins.
 *  - Onset anchoring (for tight rhythm): plain WSOLA smears drum hits / clicks
 *    and often places them ~10-15 ms early, because several overlapping frames
 *    each copy the hit to slightly different places. We detect strong onsets
 *    in the source first. Every frame whose window contains an onset is shifted
 *    so that the onset lands exactly at its nominal output time (onset/speed).
 *    Those frames then line up with each other perfectly, so the hit is
 *    reproduced once, on time. Frames just outside are kept from "seeing" the
 *    onset at all, which prevents early/late ghost copies.
 *
 * Timing guarantee (important for metronome sync): output sample f corresponds
 * to source sample f*speed, with a small local error (onsets: <= 4 ms; other
 * material: at most ±SEARCH, about 12 ms) and NO accumulated drift, because
 * every frame is placed relative to its nominal position.
 */

export interface WsolaOptions {
  /** Frame length in seconds (default 46 ms). */
  frameSec?: number;
  /** Max shift from the nominal position, in seconds (default 12 ms). */
  searchSec?: number;
  /**
   * Small bias towards the nominal position (0 = none). Keeps timing tight when
   * the correlation can't tell candidates apart (silence, noise).
   */
  nominalBias?: number;
  /** Set false to disable onset anchoring (for comparison/testing). */
  anchorOnsets?: boolean;
  /**
   * How far (seconds) an anchored onset may move from its exact nominal time to
   * get a smoother join. Bigger = smoother low notes, looser timing. Default 4 ms.
   */
  onsetToleranceSec?: number;
}

/**
 * Time-stretch `input` (one Float32Array per channel). `speed` < 1 slows down.
 * This is a generator: it periodically yields progress (0..1) so the caller can
 * report progress or cancel; the final return value is the output channels.
 */
export function* wsolaStretch(
  input: Float32Array[],
  sampleRate: number,
  speed: number,
  opts: WsolaOptions = {},
): Generator<number, Float32Array[], void> {
  const inLen = input[0]?.length ?? 0;
  const outLen = Math.round(inLen / speed);
  if (speed === 1 || inLen === 0) return input.map((ch) => ch.slice());

  const N = 2 * Math.round(((opts.frameSec ?? 0.046) * sampleRate) / 2); // even
  const H = N / 2;
  const SEARCH = Math.round((opts.searchSec ?? 0.012) * sampleRate);
  const BIAS = opts.nominalBias ?? 0.05;
  const TOL = Math.round((opts.onsetToleranceSec ?? 0.004) * sampleRate);
  const window = hann(N);

  // A decimated mono copy (~5.5 kHz) makes similarity search and onset detection cheap.
  const DEC = Math.max(1, Math.round(sampleRate / 5512));
  const dec = decimateMono(input, DEC);
  const decSq = prefixSumOfSquares(dec);
  const nDec = Math.floor(N / DEC);
  
  const onsets =
    opts.anchorOnsets === false ? [] : detectStrongOnsets(dec, sampleRate / DEC).map((i) => i * DEC);
  let onsetIdx = 0; // first onset that might still matter (onsets are sorted)

  const out = input.map(() => new Float32Array(outLen));
  const frames = Math.ceil(outLen / H) + 1;
  let prevStart = 0; // source start sample of the previous frame
  let prevAnchorIdx = -1; // onset the previous frame was anchored to

  for (let k = 0; k < frames; k++) {
    const center = k * H; // output centre of this frame
    const outStart = center - H; // frame covers output [center - H, center + H)
    const nominalStart = Math.round(center * speed) - H;

    // Allowed shift range; onsets may narrow it.
    let lo = -SEARCH;
    let hi = SEARCH;
    let anchorIdx = -1; // onset this frame must place on time (if any)
    let anchor = 0; // shift that puts that onset exactly at its nominal output time

    while (onsetIdx < onsets.length && onsets[onsetIdx] < nominalStart - SEARCH - N) onsetIdx++;
    for (let i = onsetIdx; i < onsets.length; i++) {
      const x = onsets[i];
      if (x >= nominalStart + N + SEARCH) break; // too far ahead to matter
      const a = Math.round(x - x / speed + outStart - nominalStart);
      if (a >= -SEARCH && a <= SEARCH) {
        if (anchorIdx < 0) {
          anchorIdx = i; // first (earliest) onset wins
          anchor = a;
        }
      } else if (x / speed > center) {
        hi = Math.min(hi, x - N - nominalStart); // onset ahead: keep it out of this frame
      } else {
        lo = Math.max(lo, x + 1 - nominalStart); // onset behind: keep it out as well
      }
    }

    let start: number;
    if (anchorIdx >= 0 && anchorIdx === prevAnchorIdx) {
      // Same onset as the previous frame: continue exactly, so the onset's copies coincide.
      start = prevStart + H;
    } else if (anchorIdx >= 0) {
      // New onset: land it within ±TOL of its nominal time, choosing the best-matching spot
      // (the small freedom lets low notes stay in phase across the join).
      start = nominalStart + bestShift(prevStart + H, nominalStart, Math.max(-SEARCH, anchor - TOL), Math.min(SEARCH, anchor + TOL), anchor);
    } else if (k === 0) {
      start = nominalStart;
    } else if (lo > hi) {
      start = nominalStart + bestShift(prevStart + H, nominalStart, -SEARCH, SEARCH);
    } else {
      start = nominalStart + bestShift(prevStart + H, nominalStart, lo, hi);
    }
    prevAnchorIdx = anchorIdx;

    // Overlap-add the windowed source frame into the output.
    for (let c = 0; c < input.length; c++) {
      const src = input[c];
      const dst = out[c];
      const n0 = Math.max(0, -outStart, -start);
      const n1 = Math.min(N, outLen - outStart, inLen - start);
      for (let n = n0; n < n1; n++) dst[outStart + n] += window[n] * src[start + n];
    }
    prevStart = start;
    if (k % 256 === 255) yield k / frames;
  }
  return out;

  /**
   * Find the shift in [lo, hi] whose source frame best matches `target` (the
   * natural continuation of the previous frame). Ties are broken towards `preferred`.
   */
  function bestShift(target: number, nominal: number, lo: number, hi: number, preferred = 0): number {
    // Coarse search on the decimated signal.
    const tD = Math.round(target / DEC);
    const nD = Math.round(nominal / DEC);
    let best = Math.max(lo, Math.min(hi, preferred));
    let bestScore = -Infinity;
    for (let s = Math.ceil(lo / DEC); s <= Math.floor(hi / DEC); s++) {
      const score = normCorr(dec, decSq, nD + s, tD, nDec) - (BIAS * Math.abs(s * DEC - preferred)) / SEARCH;
      if (score > bestScore) {
        bestScore = score;
        best = s * DEC;
      }
    }
    // Refine at full resolution around the coarse winner.
    const coarse = best;
    bestScore = -Infinity;
    for (let s = Math.max(lo, coarse - DEC); s <= Math.min(hi, coarse + DEC); s++) {
      const score = fullResCorr(input, nominal + s, target, N) - (BIAS * Math.abs(s - preferred)) / SEARCH;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }
}

/**
 * Find strong, sudden energy rises (drum hits, picked notes, clicks).
 * Works on the decimated mono signal; returns indices into it. Uses the first
 * difference of the signal (a simple high-pass) so that loud, steady bass notes
 * don't hide the attacks.
 */
export function detectStrongOnsets(x: Float32Array, rate: number): number[] {
  const hp = new Float32Array(x.length);
  for (let i = 1; i < x.length; i++) hp[i] = x[i] - x[i - 1];
  const sq = prefixSumOfSquares(hp);

  const block = Math.max(1, Math.round(rate * 0.0025)); // 2.5 ms energy blocks
  const history = 16; // compare with the previous 40 ms
  const nBlocks = Math.floor(x.length / block);
  if (nBlocks < history + 2) return [];
  const e = new Float64Array(nBlocks);
  for (let b = 0; b < nBlocks; b++) e[b] = sq[(b + 1) * block] - sq[b * block];
  const meanE = (sq[nBlocks * block] - sq[0]) / nBlocks;
  const minGap = Math.round(0.05 / 0.0025); // at most one onset per 50 ms

  const onsets: number[] = [];
  let last = -Infinity;
  let runSum = 0;
  for (let b = 0; b < history; b++) runSum += e[b];
  for (let b = history; b < nBlocks; b++) {
    const before = runSum / history;
    if (b - last >= minGap && e[b] > 0.1 * meanE && e[b] > 4 * before + 1e-12) {
      // Refine to the first sample in the block that is clearly above the "before" level.
      const thr = Math.max(Math.sqrt(before / block) * 3, Math.sqrt(e[b] / block) * 0.3);
      let pos = b * block;
      for (let i = b * block; i < (b + 1) * block; i++) {
        if (Math.abs(hp[i]) >= thr) {
          pos = i;
          break;
        }
      }
      onsets.push(pos);
      last = b;
    }
    runSum += e[b] - e[b - history];
  }
  return onsets;
}

/** Periodic Hann window: at 50% overlap consecutive windows sum to exactly 1. */
function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

function decimateMono(input: Float32Array[], factor: number): Float32Array {
  const len = input[0].length;
  const out = new Float32Array(Math.ceil(len / factor));
  const scale = 1 / (factor * input.length);
  for (const ch of input) {
    for (let i = 0; i < len; i++) out[(i / factor) | 0] += ch[i] * scale;
  }
  return out;
}

function prefixSumOfSquares(x: Float32Array): Float64Array {
  const p = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) p[i + 1] = p[i] + x[i] * x[i];
  return p;
}

/** Normalised correlation (-1..1) of x[a..a+len) with x[b..b+len). */
function normCorr(x: Float32Array, sq: Float64Array, a: number, b: number, len: number): number {
  let dot = 0;
  for (let i = 0; i < len; i++) {
    const ia = a + i;
    const ib = b + i;
    if (ia < 0 || ib < 0 || ia >= x.length || ib >= x.length) continue;
    dot += x[ia] * x[ib];
  }
  return dot / Math.sqrt(segEnergy(sq, a, len) * segEnergy(sq, b, len) + 1e-12);
}

function segEnergy(sq: Float64Array, start: number, len: number): number {
  const n = sq.length - 1;
  const s0 = Math.min(Math.max(start, 0), n);
  const s1 = Math.min(Math.max(start + len, 0), n);
  return sq[s1] - sq[s0];
}

/** Same as normCorr but on the full-rate signal (channels summed), every 2nd sample. */
function fullResCorr(input: Float32Array[], a: number, b: number, len: number): number {
  const L = input[0].length;
  let dot = 0;
  let ea = 0;
  let eb = 0;
  for (let i = 0; i < len; i += 2) {
    const ia = a + i;
    const ib = b + i;
    if (ia < 0 || ib < 0 || ia >= L || ib >= L) continue;
    let va = 0;
    let vb = 0;
    for (const ch of input) {
      va += ch[ia];
      vb += ch[ib];
    }
    dot += va * vb;
    ea += va * va;
    eb += vb * vb;
  }
  return dot / Math.sqrt(ea * eb + 1e-12);
}
