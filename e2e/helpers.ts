import { expect, type Page } from '@playwright/test';
import path from 'node:path';

export const AUDIO_DIR = path.resolve('test-audio');

/** The click track: 120 BPM, first beat at 0.25 s, 40 s long. */
export const CLICK = { bpm: 120, firstBeat: 0.25, beat: 0.5, duration: 40 };

/** Open the app with a clean slate (no saved data). */
export async function freshPage(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

/** Open an audio file through the file picker and wait until it's loaded. */
export async function openSong(page: Page, fileName: string) {
  await page.setInputFiles('#file-input', path.join(AUDIO_DIR, fileName));
  await expect(page.locator('#status')).toContainText('Loaded', { timeout: 120_000 });
  await expect(page.locator('#player-ui')).toBeVisible();
}

/**
 * Run `fn(window.__practice, arg)` in the page. `fn` must be self-contained
 * (it is sent to the browser as source code); pass data via `arg`.
 */
export function hooks<T, A = undefined>(page: Page, fn: (h: any, arg: A) => T | Promise<T>, arg?: A): Promise<T> {
  return page.evaluate(`(${fn.toString()})(window.__practice, ${JSON.stringify(arg ?? null)})`) as Promise<T>;
}

/** Wait until the time-stretched audio for the current speed is ready. */
export async function waitForSpeed(page: Page, speed: number) {
  await expect
    .poll(() => hooks(page, (h) => h.app.player.currentSpeed), { timeout: 120_000 })
    .toBeCloseTo(speed, 5);
}

/**
 * Align the beat grid like a user would (beat 1 on the first click in the
 * decoded audio). Lossy formats have a few ms of encoder delay, so we measure
 * instead of assuming 0.25 s.
 */
export async function alignBeatGridToAudio(page: Page) {
  const first = await hooks(page, (h) => h.originalOnsets()[0]);
  await hooks(page, (h, offset) => h.app.updateSettings({ bpm: 120, beatsPerBar: 4, beatOffset: offset }), first);
  return first;
}

/** For each click onset, the signed distance (ms) to the nearest song onset. */
export function clickToSongOffsetsMs(clicks: number[], song: number[]): number[] {
  return clicks.map((c) => {
    let best = Infinity;
    for (const s of song) if (Math.abs(s - c) < Math.abs(best)) best = s - c;
    return best * 1000;
  });
}

export function stats(xs: number[]) {
  const sorted = [...xs].sort((a, b) => a - b);
  return {
    n: xs.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: sorted[Math.floor(sorted.length / 2)],
    spread: sorted[sorted.length - 1] - sorted[0],
  };
}
