import { expect, test } from '@playwright/test';
import { freshPage, hooks, openSong } from './helpers';

const state = (page: any) => hooks(page, (h) => h.app.state);

test('keyboard shortcuts and count-in display', async ({ page }) => {
  await freshPage(page);
  await openSong(page, 'click120.wav');
  await hooks(page, (h) => {
    h.app.setSelection({ start: 2, end: 4 });
    h.app.addSectionFromSelection('A');
    h.app.setSelection({ start: 6, end: 8 });
    h.app.addSectionFromSelection('B');
  });
  await page.locator('body').click({ position: { x: 5, y: 5 } }); // focus the page, not an input

  // Space = play/pause
  await page.keyboard.press(' ');
  await expect.poll(() => hooks(page, (h) => h.app.player.isPlaying)).toBe(true);
  await page.keyboard.press(' ');
  await expect.poll(() => hooks(page, (h) => h.app.player.isPlaying)).toBe(false);

  // 1 / ] / [ = jump between sections
  await page.keyboard.press('1');
  expect((await state(page)).data.activeSectionId).toBe((await state(page)).data.sections[0].id);
  expect(await hooks(page, (h) => h.app.player.position)).toBeCloseTo(2, 3);
  await page.keyboard.press(']');
  expect(await hooks(page, (h) => h.app.player.position)).toBeCloseTo(6, 3);
  await page.keyboard.press('[');
  expect(await hooks(page, (h) => h.app.player.position)).toBeCloseTo(2, 3);

  // L = loop, M needs a BPM first, then toggles the metronome
  await page.keyboard.press('l');
  expect((await state(page)).data.loopOn).toBe(true);
  await page.keyboard.press('m');
  await expect(page.locator('#status')).toContainText('BPM');
  await page.fill('#bpm-input', '120');
  await page.keyboard.press('Enter'); // applies and leaves the field
  await page.keyboard.press('m');
  expect((await state(page)).data.settings.metronomeOn).toBe(true);

  // B = beat 1 at playhead, T = tap tempo
  await page.keyboard.press('b');
  expect((await state(page)).data.settings.beatOffset).toBeCloseTo(2, 3);

  // C = count-in before play; the big count-in number shows while counting.
  await hooks(page, (h) => h.app.updateSettings({ countInBeats: 4 }));
  await page.keyboard.press('c');
  expect((await state(page)).data.settings.countInOnStart).toBe(true);
  await page.keyboard.press(' ');
  await expect(page.locator('#countin-display')).toHaveText(/[1-4]/, { timeout: 3000 });
  await expect(page.locator('#countin-display')).toHaveText('', { timeout: 5000 }); // song started
  const pos = await hooks(page, (h) => h.app.player.position);
  expect(pos).toBeGreaterThanOrEqual(2);
  await page.keyboard.press(' ');

  // Esc clears the active section; ? shows the shortcut list.
  await page.keyboard.press('Escape');
  expect((await state(page)).data.activeSectionId).toBeNull();
  await page.keyboard.press('?');
  await expect(page.locator('#shortcuts-dialog')).toBeVisible();
  await expect(page.locator('#shortcuts-table')).toContainText('Play / pause');
});
