/** Speed controls: -/+ buttons, slider, presets and render progress. */
import type { App } from '../app';
import { SPEED_PRESETS, SPEED_RANGE, SPEED_STEP } from '../config';
import { $ } from './dom';

export function mountSpeedPanel(app: App): void {
  const slider = $<HTMLInputElement>('speed-slider');
  slider.min = String(SPEED_RANGE.min);
  slider.max = String(SPEED_RANGE.max);

  const speed = () => app.state.data.settings.speed;
  $('speed-down-btn').addEventListener('click', () => app.setSpeed(speed() - SPEED_STEP));
  $('speed-up-btn').addEventListener('click', () => app.setSpeed(speed() + SPEED_STEP));

  // While dragging only the number updates; the (slow) render starts on release.
  slider.addEventListener('input', () => ($('speed-value').textContent = pct(Number(slider.value))));
  slider.addEventListener('change', () => app.setSpeed(Number(slider.value)));

  const presets = $('speed-presets');
  for (const p of SPEED_PRESETS.filter((x) => x >= SPEED_RANGE.min && x <= SPEED_RANGE.max)) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = pct(p);
    b.dataset.speed = String(p);
    b.addEventListener('click', () => app.setSpeed(p));
    presets.appendChild(b);
  }

  app.store.subscribe((s) => {
    const v = s.data.settings.speed;
    $('speed-value').textContent = pct(v);
    if (document.activeElement !== slider) slider.value = String(v);
    for (const b of presets.querySelectorAll<HTMLButtonElement>('button')) {
      b.classList.toggle('on', Math.abs(Number(b.dataset.speed) - v) < 1e-6);
    }
    const prog = $('speed-progress');
    prog.hidden = s.stretchProgress === null;
    (prog.querySelector('.bar') as HTMLElement).style.width = `${Math.round((s.stretchProgress ?? 0) * 100)}%`;
  });
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
