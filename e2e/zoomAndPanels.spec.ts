import { expect, test, type Page } from '@playwright/test';
import { freshPage, hooks, openSong } from './helpers';

const viewOf = (page: Page) => hooks(page, (h) => h.view.view) as Promise<{ start: number; end: number }>;

test('waveform: scroll wheel zooms at the mouse, Shift+scroll and middle-drag pan', async ({ page }) => {
  await freshPage(page);
  await openSong(page, 'click120.wav'); // 40 s, starts fully zoomed out
  const box = (await page.locator('.waveform-canvas').boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + box.width * 0.25; // = 10 s while zoomed out
  const timeAtX = (v: { start: number; end: number }) => v.start + ((x - box.x) / box.width) * (v.end - v.start);

  const v0 = await viewOf(page);
  expect(v0.end - v0.start).toBeCloseTo(40, 0);

  // Wheel up = zoom in, keeping the time under the mouse in place.
  await page.mouse.move(x, y);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -100);
  await expect.poll(async () => { const v = await viewOf(page); return v.end - v.start; }).toBeLessThan(12);
  const v1 = await viewOf(page);
  expect(timeAtX(v1)).toBeCloseTo(10, 1);

  // Wheel down = zoom out again.
  await page.mouse.wheel(0, 100);
  const v2 = await viewOf(page);
  expect(v2.end - v2.start).toBeGreaterThan(v1.end - v1.start);
  expect(timeAtX(v2)).toBeCloseTo(10, 1);

  // Shift + wheel pans without changing the zoom.
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 200);
  await page.keyboard.up('Shift');
  const v3 = await viewOf(page);
  expect(v3.start).toBeGreaterThan(v2.start + 0.5);
  expect(v3.end - v3.start).toBeCloseTo(v2.end - v2.start, 5);

  // Middle-button drag pans (drag left = move later in the song).
  await page.mouse.move(x + 200, y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(x, y, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  const v4 = await viewOf(page);
  expect(v4.start).toBeGreaterThan(v3.start + 0.5);
  expect(v4.end - v4.start).toBeCloseTo(v3.end - v3.start, 5);
  // ...and doesn't create a selection or seek.
  expect(await hooks(page, (h) => h.app.state.selection)).toBeNull();
  expect(await hooks(page, (h) => h.app.player.position)).toBe(0);
});

test('overview strip works as a zoom bar', async ({ page }) => {
  await freshPage(page);
  await openSong(page, 'click120.wav');
  const ob = (await page.locator('.overview-canvas').boundingBox())!;
  const y = ob.y + ob.height / 2;
  const xAt = (t: number) => ob.x + (t / 40) * ob.width;

  // Drag the right edge of the viewport box from 40 s to 20 s -> shows 0..20 s.
  await page.mouse.move(xAt(40) - 2, y);
  await page.mouse.down();
  await page.mouse.move(xAt(20), y, { steps: 5 });
  await page.mouse.up();
  let v = await viewOf(page);
  expect(v.start).toBeCloseTo(0, 0);
  expect(v.end).toBeCloseTo(20, 0);

  // Drag the left edge from 0 s to 10 s -> 10..20 s.
  await page.mouse.move(xAt(0) + 2, y);
  await page.mouse.down();
  await page.mouse.move(xAt(10), y, { steps: 5 });
  await page.mouse.up();
  v = await viewOf(page);
  expect(v.start).toBeCloseTo(10, 0);
  expect(v.end).toBeCloseTo(20, 0);

  // Drag the box itself by +10 s -> 20..30 s (pan, same zoom).
  await page.mouse.move(xAt(15), y);
  await page.mouse.down();
  await page.mouse.move(xAt(25), y, { steps: 5 });
  await page.mouse.up();
  v = await viewOf(page);
  expect(v.start).toBeCloseTo(20, 0);
  expect(v.end).toBeCloseTo(30, 0);

  // Clicking outside the box jumps there.
  await page.mouse.click(xAt(5), y);
  expect(await hooks(page, (h) => h.app.player.position)).toBeCloseTo(5, 0);
});

test('metronome panel starts closed, shows a summary, and remembers being opened', async ({ page }) => {
  await freshPage(page);
  await openSong(page, 'click120.wav');
  const panel = page.locator('#metronome-panel');
  await expect(panel).not.toHaveAttribute('open');
  await expect(page.locator('#bpm-input')).toBeHidden();
  await expect(page.locator('#metronome-summary')).toHaveText('No BPM set');

  await page.locator('#metronome-panel > summary').click();
  await expect(page.locator('#bpm-input')).toBeVisible();
  await page.fill('#bpm-input', '96');
  await page.keyboard.press('Enter');
  await page.locator('#metronome-panel > summary').click(); // close again
  await expect(page.locator('#bpm-input')).toBeHidden();
  await expect(page.locator('#metronome-summary')).toContainText('96 BPM');

  // Pressing M while closed and without BPM would open it; with BPM it just toggles.
  await page.keyboard.press('m');
  await expect(page.locator('#metronome-summary')).toContainText('click ON');

  // Open state is remembered across reloads.
  await page.locator('#metronome-panel > summary').click();
  await page.reload();
  await openSong(page, 'click120.wav');
  await expect(page.locator('#bpm-input')).toBeVisible();
});
