/** Small DOM helpers shared by the UI modules. */

/** getElementById that throws a clear error if the element is missing. */
export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id} in index.html`);
  return el as T;
}

/** Format seconds as m:ss.t (e.g. 1:05.3). */
export function formatTime(t: number, decimals = 1): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const sStr = s.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, '0');
  return `${m}:${sStr}`;
}

/** Parse "m:ss.t", "ss.t" or plain seconds. Returns null if invalid. */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length > 2 || parts.some((p) => p === '' || isNaN(Number(p)))) return null;
  const v = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0]);
  return v >= 0 ? v : null;
}

/** Set an input's value unless the user is typing in it. */
export function setInputValue(input: HTMLInputElement, value: string): void {
  if (document.activeElement !== input && input.value !== value) input.value = value;
}

/** Toggle the "on" look + aria-pressed of a toggle button. */
export function setToggle(btn: HTMLElement, on: boolean): void {
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
}

/**
 * After a mouse click, take focus off buttons so that Space (play/pause)
 * doesn't also "click" the last pressed button.
 */
export function blurButtonsAfterClick(): void {
  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (btn && e.detail > 0) btn.blur(); // detail > 0: real mouse click, not keyboard
  });
}
