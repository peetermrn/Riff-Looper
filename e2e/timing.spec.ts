/**
 * Timing tests on the real audio output. The page records the song bus and the
 * click bus separately (AudioWorklet), we detect click onsets in both and check:
 *  - the metronome lands on the song's beats,
 *  - loop repeats join without gaps and nothing drifts over many repeats,
 *  - count-in and fixed-BPM modes behave as specified.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  alignBeatGridToAudio,
  clickToSongOffsetsMs,
  freshPage,
  hooks,
  openSong,
  stats,
  waitForSpeed,
} from './helpers';

async function setup(page: Page, file = 'click120.wav') {
  await freshPage(page);
  await openSong(page, file);
  const firstBeat = await alignBeatGridToAudio(page);
  await hooks(page, (h) => {
    h.app.updateGlobal({ clickVolume: 1, songVolume: 1 });
    h.app.updateSettings({ metronomeOn: true });
  });
  return firstBeat;
}

/** Create a section [start, end), make it active and loop it. */
async function loopSection(page: Page, start: number, end: number) {
  await hooks(
    page,
    (h, r) => {
      h.app.setSelection({ start: r.start, end: r.end });
      h.app.addSectionFromSelection('Loop');
      if (!h.app.state.data.loopOn) h.app.toggleLoop();
      h.app.seek(r.start);
    },
    { start, end },
  );
}

async function record(page: Page, seconds: number) {
  await hooks(page, (h) => h.startCapture());
  await page.click('#play-btn');
  await page.waitForTimeout(seconds * 1000);
  await page.click('#play-btn');
  await hooks(page, (h) => h.stopCapture());
  return hooks(page, (h) => h.captureOnsets()) as Promise<{ song: number[]; click: number[] }>;
}

const intervals = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]);

for (const file of ['click120.wav', 'click120.m4a']) {
  test(`metronome + loop stay locked over 20 repeats at 100% (${file})`, async ({ page }) => {
    const b = await setup(page, file);
    // 2-beat loop starting 0.1 s before a beat (a small pickup). 1.0 s per repeat.
    await loopSection(page, b + 4 - 0.1, b + 5 - 0.1);
    const heard = await record(page, 21);

    expect(heard.song.length).toBeGreaterThanOrEqual(38); // ~20 repeats x 2 beats
    // The song's own clicks keep a perfect 0.5 s grid across loop boundaries -> no gap/overlap.
    const si = stats(intervals(heard.song));
    expect(si.min).toBeGreaterThan(0.498);
    expect(si.max).toBeLessThan(0.502);
    // Metronome clicks too.
    const ci = stats(intervals(heard.click));
    expect(ci.min).toBeGreaterThan(0.499);
    expect(ci.max).toBeLessThan(0.501);
    // Every click sits on a song beat, from the first repeat to the last.
    const off = stats(clickToSongOffsetsMs(heard.click, heard.song));
    console.log(`[${file}] click->song offset ms`, off);
    expect(Math.abs(off.median)).toBeLessThan(1.5);
    expect(off.spread).toBeLessThan(1.5);
  });
}

test('metronome + loop stay locked over many repeats at 70% speed', async ({ page }) => {
  const b = await setup(page);
  await page.locator('#speed-presets button', { hasText: '70%' }).click();
  await waitForSpeed(page, 0.7);
  await loopSection(page, b + 4 - 0.1, b + 5 - 0.1); // 1.43 s per repeat at 70%
  const heard = await record(page, 22);

  const beatOut = 0.5 / 0.7;
  expect(heard.song.length).toBeGreaterThanOrEqual(28); // ~15 repeats
  const si = stats(intervals(heard.song));
  expect(si.min).toBeGreaterThan(beatOut - 0.009);
  expect(si.max).toBeLessThan(beatOut + 0.009);
  const ci = stats(intervals(heard.click));
  expect(ci.min).toBeGreaterThan(beatOut - 0.001);
  expect(ci.max).toBeLessThan(beatOut + 0.001);

  const offsets = clickToSongOffsetsMs(heard.click, heard.song);
  const off = stats(offsets);
  console.log('[70%] click->song offset ms', off);
  expect(Math.abs(off.median)).toBeLessThan(5);
  expect(off.max).toBeLessThan(6);
  expect(off.min).toBeGreaterThan(-6);
  // No drift: first repeats vs last repeats.
  const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
  expect(Math.abs(mean(offsets.slice(0, 6)) - mean(offsets.slice(-6)))).toBeLessThan(1.5);
});

test('clicks follow the song beat grid even when the loop is not a whole number of beats', async ({ page }) => {
  const b = await setup(page);
  // 2.3 beats long: the click pattern restarts with the song each repeat.
  await loopSection(page, b + 4 - 0.05, b + 4 - 0.05 + 2.3 * 0.5);
  const heard = await record(page, 14);
  expect(heard.click.length).toBeGreaterThanOrEqual(30);
  const off = stats(clickToSongOffsetsMs(heard.click, heard.song));
  expect(Math.abs(off.median)).toBeLessThan(1.5);
  expect(off.spread).toBeLessThan(1.5);
  // Every song beat gets exactly one click.
  expect(Math.abs(heard.click.length - heard.song.length)).toBeLessThanOrEqual(1);
});

test('count-in before each loop repeat', async ({ page }) => {
  const b = await setup(page);
  await hooks(page, (h) => h.app.updateSettings({ countInBeats: 2, countInOnRepeat: true, countInOnStart: true }));
  // 2-beat loop with a 0.1 s pickup. Each repeat: 1.0 s audio; count-in 2 beats leading
  // into the first beat -> 0.9 s gap of song audio. Period 1.9 s.
  await loopSection(page, b + 4 - 0.1, b + 5 - 0.1);
  const heard = await record(page, 14);

  const si = intervals(heard.song);
  // Song beats come in pairs: 0.5 s apart within a repeat, 1.4 s from repeat to repeat.
  for (const d of si) expect(Math.min(Math.abs(d - 0.5), Math.abs(d - 1.4))).toBeLessThan(0.003);
  expect(si.filter((d) => Math.abs(d - 1.4) < 0.003).length).toBeGreaterThanOrEqual(5);

  // Each repeat: 2 count-in clicks + 2 metronome clicks, all 0.5 s apart except the
  // 0.4 s from the last metronome click to the next count-in (which aligns to the next downbeat).
  const ci = intervals(heard.click);
  for (const d of ci) expect(Math.min(Math.abs(d - 0.5), Math.abs(d - 0.4))).toBeLessThan(0.002);
  expect(heard.click.length).toBeGreaterThanOrEqual(heard.song.length * 2 - 2);

  // The first song beat of each repeat comes exactly one beat after the last count-in click.
  for (let i = 1; i < si.length; i++) {
    if (Math.abs(si[i - 1] - 1.4) > 0.003) continue;
    const beat = heard.song[i];
    const prevClick = heard.click.filter((c) => c < beat - 0.01).pop()!;
    expect(beat - prevClick).toBeCloseTo(0.5, 2);
  }
});

test('fixed-BPM click ignores song speed', async ({ page }) => {
  const b = await setup(page);
  await hooks(page, (h) => h.app.updateSettings({ clickFollowsSpeed: false }));
  await page.locator('#speed-presets button', { hasText: '80%' }).click();
  await waitForSpeed(page, 0.8);
  await hooks(page, (h, start) => h.app.seek(start), b + 4 - 0.05);
  const heard = await record(page, 6);
  const ci = stats(intervals(heard.click));
  expect(ci.min).toBeGreaterThan(0.499); // 120 BPM regardless of the 80% speed
  expect(ci.max).toBeLessThan(0.501);
  const si = stats(intervals(heard.song));
  expect(si.median).toBeCloseTo(0.625, 2); // the song itself is slowed
  // Both start on the same beat.
  expect(Math.abs(heard.click[0] - heard.song[0])).toBeLessThan(0.006);
});

test('loop joins are seamless (continuous tone has no gap or dip)', async ({ page }) => {
  await freshPage(page);
  await openSong(page, 'tone440.wav');
  await loopSection(page, 1.0, 2.0); // exactly 440 periods -> waveform continues smoothly
  await hooks(page, (h) => h.startCapture());
  await page.click('#play-btn');
  await page.waitForTimeout(12_000);
  await page.click('#play-btn');
  await hooks(page, (h) => h.stopCapture());
  // 25 ms windows = exactly 11 periods of 440 Hz, so a steady tone gives a flat RMS.
  // A gap of even ~3 ms would pull a window's RMS down by >10%.
  const rms: number[] = await hooks(page, (h) => h.captureRms(0.025));
  // Ignore the very start/end (fade in/out and silence before play).
  const peak = Math.max(...rms);
  const loud = rms.findIndex((v) => v > peak / 2);
  const steady = rms.slice(loud + 2, loud + 2 + 400); // ~10 s, ~10 loop joins
  const s = stats(steady);
  expect(steady.length).toBe(400);
  expect(s.min / s.max).toBeGreaterThan(0.97);
});
