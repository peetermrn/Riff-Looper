import { expect, test } from '@playwright/test';
import { CLICK, freshPage, hooks, openSong } from './helpers';

/**
 * Every supported format must decode (natively or via the ffmpeg fallback)
 * and actually play.
 */
const FORMATS = ['m4a', 'aac', 'mp3', 'wav', 'ogg', 'flac'];

for (const ext of FORMATS) {
  test(`decodes and plays .${ext}`, async ({ page }, testInfo) => {
    const ffmpegRequests: string[] = [];
    page.on('request', (r) => r.url().includes('ffmpeg') && ffmpegRequests.push(r.url()));
    await freshPage(page);
    await openSong(page, `click120.${ext}`);

    const decoder = await hooks(page, (h) => h.decoder());
    testInfo.annotations.push({ type: 'decoder', description: `${ext}: ${decoder}` });
    console.log(`[${testInfo.project.name}] .${ext} decoded with: ${decoder}`);

    // Right length (lossy codecs add a little padding)
    const duration = await hooks(page, (h) => h.duration());
    expect(duration).toBeGreaterThan(CLICK.duration - 0.01);
    expect(duration).toBeLessThan(CLICK.duration + 0.2);

    // Decoded content is the click track: 80 clicks, 0.5 s apart.
    const onsets = await hooks(page, (h) => h.originalOnsets());
    expect(onsets.length).toBe(80);
    expect(onsets[0]).toBeGreaterThan(0.24);
    expect(onsets[0]).toBeLessThan(0.32); // encoder delay of lossy formats
    for (let i = 1; i < onsets.length; i++) expect(onsets[i] - onsets[i - 1]).toBeCloseTo(0.5, 2);

    // It plays: the song bus produces the clicks in real time.
    await hooks(page, (h) => h.startCapture());
    await page.click('#play-btn');
    await page.waitForTimeout(2000);
    await page.click('#play-btn'); // pause
    await hooks(page, (h) => h.stopCapture());
    const heard = await hooks(page, (h) => h.captureOnsets());
    expect(heard.song.length).toBeGreaterThanOrEqual(3);
    const pos = await hooks(page, (h) => h.app.player.position);
    expect(pos).toBeGreaterThan(1.5);

    // The heavy fallback decoder must not be downloaded when the browser decodes natively.
    if (decoder === 'native') expect(ffmpegRequests).toEqual([]);
  });
}

/**
 * Simulate a browser that can't decode AAC itself (e.g. some Linux Chromium
 * builds, Firefox without system codecs): the ffmpeg.wasm fallback must kick in.
 */
for (const ext of ['m4a', 'aac']) {
  test(`falls back to ffmpeg.wasm for .${ext} when native decoding fails`, async ({ page }) => {
    await page.addInitScript(() => {
      BaseAudioContext.prototype.decodeAudioData = function () {
        return Promise.reject(new DOMException('Unable to decode audio data', 'EncodingError'));
      };
    });
    await freshPage(page);
    await openSong(page, `click120.${ext}`);
    expect(await hooks(page, (h) => h.decoder())).toBe('ffmpeg');
    const duration = await hooks(page, (h) => h.duration());
    expect(duration).toBeGreaterThan(CLICK.duration - 0.01);
    expect(duration).toBeLessThan(CLICK.duration + 0.2);
    const onsets = await hooks(page, (h) => h.originalOnsets());
    expect(onsets.length).toBe(80);

    await hooks(page, (h) => h.startCapture());
    await page.click('#play-btn');
    await page.waitForTimeout(1500);
    await page.click('#play-btn');
    await hooks(page, (h) => h.stopCapture());
    expect((await hooks(page, (h) => h.captureOnsets())).song.length).toBeGreaterThanOrEqual(2);
  });
}
