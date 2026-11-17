/// <reference lib="webworker" />
/**
 * Web Worker that runs WSOLA off the main thread, so the UI (and audio that is
 * already playing) stays smooth while a new speed is being rendered.
 *
 * Messages in:  { type: 'source', channels, sampleRate }
 *               { type: 'render', id, speed }
 * Messages out: { type: 'progress', id, fraction }
 *               { type: 'done', id, channels }   (channel buffers are transferred)
 *               { type: 'error', id, message }
 */
import { wsolaStretch } from './wsola';

let source: Float32Array[] = [];
let sampleRate = 44100;
let currentJob = 0;

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'source') {
    source = msg.channels;
    sampleRate = msg.sampleRate;
    currentJob = 0;
  } else if (msg.type === 'render') {
    currentJob = msg.id;
    try {
      const gen = wsolaStretch(source, sampleRate, msg.speed);
      for (;;) {
        const step = gen.next();
        if (step.done) {
          const channels = step.value;
          (self as DedicatedWorkerGlobalScope).postMessage(
            { type: 'done', id: msg.id, channels },
            channels.map((c) => c.buffer as ArrayBuffer),
          );
          return;
        }
        self.postMessage({ type: 'progress', id: msg.id, fraction: step.value });
        // Yield to the event loop so a newer 'render' message can supersede this one.
        await new Promise((r) => setTimeout(r, 0));
        if (currentJob !== msg.id) return; // superseded; the main thread already moved on
      }
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, message: String(err) });
    }
  }
};
