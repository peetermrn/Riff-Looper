/**
 * Tiny onset detector used by the automated tests (unit tests and the in-browser
 * sync checks). Finds the sample index where the signal first exceeds a
 * threshold after having been quiet for at least `quietSec`.
 */
export function detectOnsets(
  x: Float32Array,
  sampleRate: number,
  { thresholdRatio = 0.25, quietSec = 0.1, absThreshold = 0 } = {},
): number[] {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const thr = Math.max(absThreshold, peak * thresholdRatio);
  if (peak === 0) return [];
  const quiet = Math.round(quietSec * sampleRate);
  const onsets: number[] = [];
  let lastLoud = -Infinity;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]) >= thr) {
      if (i - lastLoud > quiet) onsets.push(i);
      lastLoud = i;
    }
  }
  return onsets;
}

/** Estimate frequency of a (mostly) pure tone from upward zero crossings. */
export function estimateFrequency(x: Float32Array, sampleRate: number): number {
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = 1; i < x.length; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      // linear interpolation of the crossing point
      const pos = i - 1 + -x[i - 1] / (x[i] - x[i - 1]);
      if (first < 0) first = pos;
      else count++;
      last = pos;
    }
  }
  return count > 0 ? (count * sampleRate) / (last - first) : 0;
}
