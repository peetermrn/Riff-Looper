import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { freshPage, hooks, openSong } from './helpers';

/** Screen x/y helpers for the main waveform (zoomed to fit = whole song visible). */
async function waveGeometry(page: Page) {
  const box = (await page.locator('.waveform-canvas').boundingBox())!;
  const duration = await hooks(page, (h) => h.duration());
  return {
    x: (t: number) => box.x + (t / duration) * box.width,
    y: box.y + box.height / 2,
  };
}

async function drag(page: Page, x0: number, x1: number, y: number) {
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, y, { steps: 3 });
  await page.mouse.move(x1, y, { steps: 3 });
  await page.mouse.up();
}

const sections = (page: Page) => hooks(page, (h) => h.app.state.data.sections);

test('create, rename, resize, jump to and delete sections; restored after reload', async ({ page }) => {
  page.on('dialog', (d) => d.accept()); // confirm() for delete
  await freshPage(page);
  await openSong(page, 'click120.wav');
  const g = await waveGeometry(page);

  // 1) Drag-select 4 s .. 8 s, press N, type a name.
  await drag(page, g.x(4), g.x(8), g.y);
  const sel = await hooks(page, (h) => h.app.state.selection);
  expect(sel.start).toBeCloseTo(4, 0);
  expect(sel.end).toBeCloseTo(8, 0);
  await page.keyboard.press('n');
  const firstName = page.locator('.section-item .name').first();
  await expect(firstName).toBeFocused();
  await page.keyboard.type('Chorus 1');
  await page.keyboard.press('Enter');

  // 2) Second section with the button.
  await drag(page, g.x(12), g.x(16), g.y);
  await page.click('#add-section-btn');
  await expect(page.locator('.section-item .name').nth(1)).toBeFocused();
  await page.keyboard.type('Verse');
  await page.keyboard.press('Enter');

  await expect(page.locator('.section-item .name')).toHaveCount(2);
  await expect(page.locator('.section-item .name').nth(0)).toHaveValue('Chorus 1');
  await expect(page.locator('.section-item .name').nth(1)).toHaveValue('Verse');

  // 3) Resize: drag the end edge of "Chorus 1" from 8 s to 10 s.
  const before = (await sections(page))[0];
  await drag(page, g.x(before.end), g.x(10), g.y);
  const resized = (await sections(page))[0];
  expect(resized.name).toBe('Chorus 1');
  expect(resized.start).toBeCloseTo(before.start, 5);
  expect(resized.end).toBeCloseTo(10, 0);

  // 4) Rename in the list.
  await page.locator('.section-item .name').nth(1).fill('Verse A');
  await page.keyboard.press('Enter');
  expect((await sections(page))[1].name).toBe('Verse A');

  // 5) Clicking a section in the list jumps to it.
  await page.locator('.section-item .swatch').nth(1).click();
  expect(await hooks(page, (h) => h.app.player.position)).toBeCloseTo((await sections(page))[1].start, 3);
  await expect(page.locator('.section-item').nth(1)).toHaveClass(/active/);

  // 6) Loop it with the keyboard: the loop region is that section.
  await page.keyboard.press('l');
  expect(await hooks(page, (h) => h.app.state.data.loopOn)).toBe(true);
  await expect(page.locator('#loop-info')).toContainText('Verse A');

  // 7) Delete it.
  await page.locator('.section-item .delete').nth(1).click();
  await expect(page.locator('.section-item')).toHaveCount(1);

  // 8) Reload the page, open the same song: sections and settings come back.
  await hooks(page, (h) => h.app.updateSettings({ bpm: 97.5, beatOffset: 0.123 }));
  await page.waitForTimeout(500); // autosave is debounced
  await page.reload();
  await openSong(page, 'click120.wav');
  await expect(page.locator('#status')).toContainText('restored 1 section');
  const restored = await sections(page);
  expect(restored.map((s: any) => s.name)).toEqual(['Chorus 1']);
  expect(restored[0].end).toBeCloseTo(resized.end, 5);
  await expect(page.locator('#bpm-input')).toHaveValue('97.5');
  await expect(page.locator('#offset-input')).toHaveValue('0.123');
});

test('export and import sections + settings', async ({ page }, testInfo) => {
  page.on('dialog', (d) => d.accept());
  await freshPage(page);
  await openSong(page, 'click120.wav');
  await hooks(page, (h) => {
    h.app.updateSettings({ bpm: 120, beatOffset: 0.25, countInBeats: 2, countInOnStart: true });
    h.app.setSelection({ start: 1, end: 3 });
    h.app.addSectionFromSelection('Intro');
    h.app.setSelection({ start: 5.5, end: 9.25 });
    h.app.addSectionFromSelection('Riff');
  });

  // Export -> a small JSON download
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
  expect(download.suggestedFilename()).toBe('click120.practice.json');
  const exportPath = testInfo.outputPath('export.json');
  await download.saveAs(exportPath);
  const json = JSON.parse(readFileSync(exportPath, 'utf8'));
  expect(json.format).toBe('practice-player');
  expect(json.song.fileName).toBe('click120.wav');
  expect(json.data.sections.map((s: any) => s.name)).toEqual(['Intro', 'Riff']);
  expect(json.data.settings.bpm).toBe(120);

  // A friend opens the same song (fresh browser storage) and imports the file.
  await freshPage(page);
  await openSong(page, 'click120.wav');
  expect(await sections(page)).toEqual([]);
  await page.setInputFiles('#import-input', exportPath);
  await expect(page.locator('#status')).toContainText('Imported 2 section');
  expect((await sections(page)).map((s: any) => s.name)).toEqual(['Intro', 'Riff']);
  await expect(page.locator('#bpm-input')).toHaveValue('120');
  await expect(page.locator('#countin-start-btn')).toHaveClass(/on/);

  // Importing into a different file (e.g. the friend's .m4a of the same song) asks first.
  let asked = '';
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => {
    asked = d.message();
    void d.accept();
  });
  await openSong(page, 'click120.m4a');
  await page.setInputFiles('#import-input', exportPath);
  await expect(page.locator('#status')).toContainText('Imported 2 section');
  expect(asked).toContain('different file');

  // Invalid files are rejected with a message.
  const bad = testInfo.outputPath('bad.json');
  writeFileSync(bad, '{"hello": 1}');
  await page.setInputFiles('#import-input', bad);
  await expect(page.locator('#status')).toContainText('not a practice file');
});

test('speed: slows down without changing pitch; keyboard shortcuts', async ({ page }) => {
  await freshPage(page);
  await openSong(page, 'tone440.wav');

  await page.locator('#speed-presets button', { hasText: '70%' }).click();
  await expect(page.locator('#speed-value')).toHaveText('70%');
  await expect(page.locator('#speed-progress')).toBeVisible();
  const { waitForSpeed } = await import('./helpers');
  await waitForSpeed(page, 0.7);
  await expect(page.locator('#speed-progress')).toBeHidden();

  const info = await hooks(page, (h) => h.playBufferInfo());
  expect(info.duration).toBeCloseTo(10 / 0.7, 2);
  const freq = await hooks(page, (h) => h.playBufferFrequency(2, 6));
  expect(freq).toBeGreaterThan(438);
  expect(freq).toBeLessThan(442);

  // Song position advances at 70% of real time.
  await page.click('#play-btn');
  await page.waitForTimeout(300);
  const t0 = await hooks(page, (h) => ({ pos: h.app.player.position, ctx: h.ctxTime() }));
  await page.waitForTimeout(2000);
  const t1 = await hooks(page, (h) => ({ pos: h.app.player.position, ctx: h.ctxTime() }));
  expect((t1.pos - t0.pos) / (t1.ctx - t0.ctx)).toBeCloseTo(0.7, 2);

  // Arrow keys change speed in 5% steps; clamped to the configured range.
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#speed-value')).toHaveText('75%');
  await waitForSpeed(page, 0.75);
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown');
  await expect(page.locator('#speed-value')).toHaveText('70%');
  await page.keyboard.press(' ');
  expect(await hooks(page, (h) => h.app.player.isPlaying)).toBe(false);

  // Back to 100% plays the original buffer.
  await page.locator('#speed-presets button', { hasText: '100%' }).click();
  await waitForSpeed(page, 1);
  expect((await hooks(page, (h) => h.playBufferInfo())).duration).toBeCloseTo(10, 2);
});
