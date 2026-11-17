/**
 * Turns an audio file into an AudioBuffer.
 *
 * 1. Try the browser's own decoder (fast, no download).
 * 2. If the browser can't decode this format (e.g. AAC in some Linux Chromium
 *    builds or Firefox installs without system codecs), lazily load an
 *    ffmpeg.wasm-based decoder and use that. The fallback (~30 MB) is only
 *    downloaded the first time it's actually needed, then cached by the browser.
 *
 * The file never leaves the computer: everything is decoded locally.
 */

export type DecoderUsed = 'native' | 'ffmpeg';

export interface DecodedAudio {
  buffer: AudioBuffer;
  decoder: DecoderUsed;
}

export async function decodeAudioFile(
  ctx: BaseAudioContext,
  bytes: ArrayBuffer,
  fileName: string,
  onStatus: (message: string) => void = () => {},
): Promise<DecodedAudio> {
  try {
    // decodeAudioData detaches the buffer it is given, so pass a copy.
    const buffer = await ctx.decodeAudioData(bytes.slice(0));
    if (buffer.length > 0) return { buffer, decoder: 'native' };
  } catch {
    // Not supported natively -> fall through to the fallback decoder.
  }

  onStatus('This browser can’t decode this file natively. Loading the fallback decoder (one-time ~30 MB download)…');
  const { decodeWithFfmpeg } = await import('./ffmpegDecoder');
  const buffer = await decodeWithFfmpeg(ctx, new Uint8Array(bytes.slice(0)), fileName, onStatus);
  return { buffer, decoder: 'ffmpeg' };
}
