/**
 * Keyboard shortcuts. The SHORTCUTS table drives both the key handling and the
 * help dialog, so they can't get out of sync. Add or change shortcuts here.
 */
import type { App } from '../app';
import { SPEED_STEP } from '../config';
import { $ } from './dom';

export interface ShortcutContext {
  app: App;
  zoomIn(): void;
  zoomOut(): void;
  zoomFit(): void;
  addSection(): void;
  showHelp(): void;
  openFile(): void;
}

interface Shortcut {
  /** Keys shown in the help dialog. */
  keys: string[];
  label: string;
  /** Returns true if this shortcut handles the event. */
  match(e: KeyboardEvent): boolean;
  run(c: ShortcutContext, e: KeyboardEvent): void;
}

const key = (...names: string[]) => (e: KeyboardEvent) => names.includes(e.key) || names.includes(e.code);
const letter = (l: string) => (e: KeyboardEvent) =>
  !e.ctrlKey && !e.metaKey && !e.altKey && (e.key.toLowerCase() === l || e.code === `Key${l.toUpperCase()}`);

export const SHORTCUTS: Shortcut[] = [
  { keys: ['Space'], label: 'Play / pause', match: key(' ', 'Space'), run: (c) => c.app.togglePlay() },
  { keys: ['L'], label: 'Loop on / off', match: letter('l'), run: (c) => c.app.toggleLoop() },
  { keys: ['←', '→'], label: 'Back / forward 2 s (with Shift: 10 s)', match: key('ArrowLeft', 'ArrowRight'),
    run: (c, e) => c.app.seekSmall(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey) },
  { keys: ['Home'], label: 'Go to start of section (or song)', match: key('Home'), run: (c) => c.app.goToStart() },
  { keys: ['↓', '↑'], label: `Slower / faster (${Math.round(SPEED_STEP * 100)}%)`, match: key('ArrowDown', 'ArrowUp'),
    run: (c, e) => c.app.setSpeed(c.app.state.data.settings.speed + (e.key === 'ArrowDown' ? -SPEED_STEP : SPEED_STEP)) },
  { keys: ['N', 'Enter'], label: 'Add section from selection', match: (e) => letter('n')(e) || e.key === 'Enter',
    run: (c) => c.addSection() },
  { keys: ['[', ']'], label: 'Previous / next section', match: key('[', ']'),
    run: (c, e) => c.app.activateAdjacent(e.key === '[' ? -1 : 1) },
  { keys: ['1…9'], label: 'Jump to section 1–9', match: (e) => /^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey,
    run: (c, e) => c.app.activateByIndex(Number(e.key) - 1) },
  { keys: ['M'], label: 'Metronome on / off', match: letter('m'), run: (c) => c.app.toggleMetronome() },
  { keys: ['C'], label: 'Count-in before play on / off', match: letter('c'), run: (c) => c.app.toggleCountIn() },
  { keys: ['B'], label: 'Set beat 1 at the playhead', match: letter('b'), run: (c) => c.app.setBeatOneAtPlayhead() },
  { keys: ['T'], label: 'Tap tempo', match: letter('t'), run: (c) => c.app.tapTempo() },
  { keys: ['+', '−'], label: 'Zoom in / out', match: key('+', '=', '-', '_'),
    run: (c, e) => (e.key === '-' || e.key === '_' ? c.zoomOut() : c.zoomIn()) },
  { keys: ['0'], label: 'Zoom to whole song', match: key('0'), run: (c) => c.zoomFit() },
  { keys: ['O'], label: 'Open a song', match: letter('o'), run: (c) => c.openFile() },
  { keys: ['Esc'], label: 'Clear selection / deselect section', match: key('Escape'), run: (c) => c.app.clearSelection() },
  { keys: ['?'], label: 'Show this list', match: key('?'), run: (c) => c.showHelp() },
];

export function mountShortcuts(c: ShortcutContext): void {
  document.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return;
    if ((e.target as HTMLElement).closest?.('dialog')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) {
      // leave browser shortcuts alone (Ctrl+R, Ctrl+F, ...)
      return;
    }
    const s = SHORTCUTS.find((x) => x.match(e));
    if (!s) return;
    e.preventDefault();
    s.run(c, e);
  });
  // Stop Space from "clicking" a focused button on key-up.
  document.addEventListener('keyup', (e) => {
    if (e.key === ' ' && !isTyping(e.target)) e.preventDefault();
  });

  const table = $<HTMLTableElement>('shortcuts-table');
  for (const s of SHORTCUTS) {
    const tr = table.insertRow();
    tr.insertCell().innerHTML = s.keys.map((k) => `<kbd>${k}</kbd>`).join(' ');
    tr.insertCell().textContent = s.label;
  }
  const extra = table.insertRow();
  extra.insertCell().innerHTML = '<kbd>Ctrl</kbd>+scroll';
  extra.insertCell().textContent = 'Zoom the waveform at the mouse';
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el instanceof HTMLInputElement) return !['range', 'checkbox', 'radio', 'button'].includes(el.type);
  return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable;
}
