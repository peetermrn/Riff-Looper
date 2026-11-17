/**
 * Picks the time-stretch engine used by the app. To try a different engine,
 * implement `TimeStretcher` and return it here.
 */
import { StretchCancelled, type TimeStretcher } from './TimeStretcher';

export { StretchCancelled, type TimeStretcher };

export function createTimeStretcher(): TimeStretcher {
  return new WsolaWorkerStretcher();
}

/** WSOLA (see ./wsola.ts) running in a Web Worker. */
class WsolaWorkerStretcher implements TimeStretcher {
  private worker = new Worker(new URL('./wsola.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending: {
    id: number;
    resolve: (c: Float32Array[]) => void;
    reject: (e: Error) => void;
    onProgress?: (f: number) => void;
  } | null = null;

  constructor() {
    this.worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      const job = this.pending;
      if (!job || msg.id !== job.id) return; // stale message from a superseded job
      if (msg.type === 'progress') job.onProgress?.(msg.fraction);
      else if (msg.type === 'done') {
        this.pending = null;
        job.resolve(msg.channels);
      } else if (msg.type === 'error') {
        this.pending = null;
        job.reject(new Error(msg.message));
      }
    };
  }

  setSource(channels: Float32Array[], sampleRate: number): void {
    this.cancelPending();
    // Copies are sent (structured clone) because the app keeps using the originals.
    this.worker.postMessage({ type: 'source', channels, sampleRate });
  }

  render(speed: number, onProgress?: (fraction: number) => void): Promise<Float32Array[]> {
    this.cancelPending();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject, onProgress };
      this.worker.postMessage({ type: 'render', id, speed });
    });
  }

  dispose(): void {
    this.cancelPending();
    this.worker.terminate();
  }

  private cancelPending() {
    if (this.pending) {
      this.pending.reject(new StretchCancelled());
      this.pending = null;
    }
  }
}
