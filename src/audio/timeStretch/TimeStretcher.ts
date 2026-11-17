/**
 * The time-stretch engine interface. The rest of the app only talks to this,
 * so the engine can be swapped (e.g. for Rubber Band / Signalsmith Stretch
 * compiled to WASM) by writing a new class and changing `createTimeStretcher`
 * in ./index.ts.
 *
 * CONTRACT for implementations (the metronome relies on it):
 *  - render(speed) returns the whole song re-timed, keeping the pitch.
 *  - Output length is round(sourceLength / speed) samples, same sample rate.
 *  - Output sample f must correspond to source sample f * speed. I.e. any
 *    internal latency/delay MUST be compensated; no constant offset, no drift.
 */
export interface TimeStretcher {
  /** Give the engine the original (decoded) audio. Called once per song. */
  setSource(channels: Float32Array[], sampleRate: number): void;

  /**
   * Render the whole song at `speed` (e.g. 0.8 = 80% speed). A new call
   * supersedes a running one; the superseded promise rejects with
   * `StretchCancelled`.
   */
  render(speed: number, onProgress?: (fraction: number) => void): Promise<Float32Array[]>;

  /** Free resources (workers, memory). */
  dispose(): void;
}

export class StretchCancelled extends Error {
  constructor() {
    super('Time-stretch render was superseded');
    this.name = 'StretchCancelled';
  }
}
