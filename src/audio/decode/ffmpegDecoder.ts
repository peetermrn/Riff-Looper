/**
 * Fallback decoder using ffmpeg compiled to WebAssembly (@ffmpeg/ffmpeg).
 * Only imported (and its ~30 MB core downloaded) when the native decoder fails.
 *
 * The core files are served from our own site under /ffmpeg/ (copied there by
 * scripts/copy-ffmpeg-core.mjs at dev/build time), so no third-party CDN is used.
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';

let loading: Promise<FFmpeg> | null = null;

function getFFmpeg(): Promise<FFmpeg> {
  if (!loading) {
    loading = (async () => {
      const ffmpeg = new FFmpeg();
      const base = new URL('ffmpeg/', document.baseURI).href;
      await ffmpeg.load({ coreURL: base + 'ffmpeg-core.js', wasmURL: base + 'ffmpeg-core.wasm' });
      return ffmpeg;
    })();
    loading.catch(() => (loading = null)); // allow a retry after a failed download
  }
  return loading;
}

export async function decodeWithFfmpeg(
  ctx: BaseAudioContext,
  bytes: Uint8Array,
  fileName: string,
  onStatus: (message: string) => void,
): Promise<AudioBuffer> {
  const ffmpeg = await getFFmpeg();
  onStatus('Decoding with the fallback decoder…');

  const ext = (fileName.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
  const inName = 'input' + ext;
  const outName = 'output.f32';
  await ffmpeg.writeFile(inName, bytes);
  try {
    // Decode to raw 32-bit float, stereo, at the AudioContext's sample rate.
    const code = await ffmpeg.exec([
      '-i', inName, '-vn', '-f', 'f32le', '-acodec', 'pcm_f32le',
      '-ac', '2', '-ar', String(ctx.sampleRate), outName,
    ]);
    if (code !== 0) throw new Error('The fallback decoder could not read this file.');
    const data = (await ffmpeg.readFile(outName)) as Uint8Array;
    const interleaved = new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4));
    const frames = Math.floor(interleaved.length / 2);
    if (frames === 0) throw new Error('The file contains no audio.');
    const buffer = ctx.createBuffer(2, frames, ctx.sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let i = 0; i < frames; i++) {
      left[i] = interleaved[2 * i];
      right[i] = interleaved[2 * i + 1];
    }
    return buffer;
  } finally {
    await ffmpeg.deleteFile(inName).catch(() => {});
    await ffmpeg.deleteFile(outName).catch(() => {});
  }
}
