/**
 * Produces the AudioBuffer to play for a given speed, using the TimeStretcher.
 * Rendering happens in the background; the player keeps playing the old speed
 * until the new one is ready, then switches seamlessly.
 */
import { StretchCancelled, type TimeStretcher } from './timeStretch';

const CACHE_SIZE = 2; // keep the last couple of rendered speeds (they use a lot of memory)

export class SpeedController {
  private original: AudioBuffer | null = null;
  private cache = new Map<string, AudioBuffer>();
  private wanted = 1;

  constructor(
    private ctx: BaseAudioContext,
    private stretcher: TimeStretcher,
    /** Called with the buffer to play once it's ready. */
    private onReady: (buffer: AudioBuffer, speed: number) => void,
    /** Render progress 0..1, or null when done/idle. */
    private onProgress: (fraction: number | null) => void,
  ) {}

  setSource(buffer: AudioBuffer): void {
    this.original = buffer;
    this.cache.clear();
    this.wanted = 1;
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    this.stretcher.setSource(channels, buffer.sampleRate);
    this.onProgress(null);
  }

  /** Ask for `speed`. Resolves when that speed is playing (or was superseded). */
  async request(speed: number): Promise<void> {
    const original = this.original;
    if (!original) return;
    this.wanted = speed;
    if (Math.abs(speed - 1) < 1e-6) {
      this.onProgress(null);
      this.onReady(original, 1);
      return;
    }
    const key = speed.toFixed(3);
    const cached = this.cache.get(key);
    if (cached) {
      this.onProgress(null);
      this.onReady(cached, speed);
      return;
    }
    try {
      this.onProgress(0);
      const channels = await this.stretcher.render(speed, (f) => this.onProgress(f));
      if (this.wanted !== speed || this.original !== original) return; // user moved on
      const buffer = this.ctx.createBuffer(channels.length, channels[0].length, original.sampleRate);
      channels.forEach((ch, c) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
      this.cache.set(key, buffer);
      while (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
      this.onProgress(null);
      this.onReady(buffer, speed);
    } catch (e) {
      if (e instanceof StretchCancelled) return;
      this.onProgress(null);
      throw e;
    }
  }
}
