/** BPM, beat alignment, metronome, click mode, count-in and volumes. */
import type { App } from '../app';
import { loadUiFlag, saveUiFlag } from '../storage/persistence';
import { $, setInputValue, setToggle } from './dom';

export function mountMetronomePanel(app: App): void {
  const bpm = $<HTMLInputElement>('bpm-input');
  const bpb = $<HTMLInputElement>('bpb-input');
  const offset = $<HTMLInputElement>('offset-input');
  const countInBeats = $<HTMLInputElement>('countin-beats');
  const clickVol = $<HTMLInputElement>('click-volume');
  const songVol = $<HTMLInputElement>('song-volume');

  // The panel is collapsible and starts closed; remember what the user chose.
  const panel = $<HTMLDetailsElement>('metronome-panel');
  panel.open = loadUiFlag('metronomeOpen', false);
  panel.addEventListener('toggle', () => saveUiFlag('metronomeOpen', panel.open));
  // 'toggle' fires asynchronously; also save on leaving so a quick reload can't lose it.
  window.addEventListener('pagehide', () => saveUiFlag('metronomeOpen', panel.open));
  // e.g. pressing M before a BPM is set: open the panel and put the cursor in the BPM field.
  app.onNeedBpm(() => {
    panel.open = true;
    bpm.focus();
  });

  // Number inputs apply on change (Enter / leaving the field) or valid typing.
  onNumber(bpm, (v) => app.updateSettings({ bpm: v === null ? null : clamp(v, 20, 400) }), true);
  onNumber(bpb, (v) => v !== null && app.updateSettings({ beatsPerBar: Math.round(clamp(v, 1, 16)) }));
  onNumber(offset, (v) => v !== null && app.updateSettings({ beatOffset: v }));
  onNumber(countInBeats, (v) => v !== null && app.updateSettings({ countInBeats: Math.round(clamp(v, 1, 16)) }));

  $('tap-btn').addEventListener('click', () => app.tapTempo());
  $('beat-here-btn').addEventListener('click', () => app.setBeatOneAtPlayhead());
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-nudge]')) {
    b.addEventListener('click', () => app.nudgeBeatOffset(Number(b.dataset.nudge)));
  }
  $('metronome-btn').addEventListener('click', () => app.toggleMetronome());
  $('follow-speed-btn').addEventListener('click', () => app.updateSettings({ clickFollowsSpeed: true }));
  $('fixed-bpm-btn').addEventListener('click', () => app.updateSettings({ clickFollowsSpeed: false }));
  $('countin-start-btn').addEventListener('click', () => app.toggleCountIn());
  $('countin-repeat-btn').addEventListener('click', () => {
    if (!app.state.data.settings.bpm) return app.setStatus('Type the song’s BPM first.', 'error');
    app.updateSettings({ countInOnRepeat: !app.state.data.settings.countInOnRepeat });
  });
  clickVol.addEventListener('input', () => app.updateGlobal({ clickVolume: Number(clickVol.value) }));
  songVol.addEventListener('input', () => app.updateGlobal({ songVolume: Number(songVol.value) }));

  app.store.subscribe((s) => {
    const st = s.data.settings;
    setInputValue(bpm, st.bpm === null ? '' : String(st.bpm));
    setInputValue(bpb, String(st.beatsPerBar));
    setInputValue(offset, st.beatOffset.toFixed(3));
    setInputValue(countInBeats, String(st.countInBeats));
    setInputValue(clickVol, String(s.global.clickVolume));
    setInputValue(songVol, String(s.global.songVolume));
    setToggle($('metronome-btn'), st.metronomeOn);
    $('metronome-btn').textContent = st.metronomeOn ? 'Metronome ON' : 'Metronome off';
    $('follow-speed-btn').setAttribute('aria-checked', String(st.clickFollowsSpeed));
    $('fixed-bpm-btn').setAttribute('aria-checked', String(!st.clickFollowsSpeed));
    setToggle($('countin-start-btn'), st.countInOnStart);
    setToggle($('countin-repeat-btn'), st.countInOnRepeat);
    $('metronome-summary').textContent = summary(st);
    const noBpm = !st.bpm;
    for (const id of ['metronome-btn', 'countin-start-btn', 'countin-repeat-btn', 'beat-here-btn']) {
      ($(id) as HTMLButtonElement).disabled = noBpm;
    }
  });
}

/** One-line summary shown in the header while the panel is closed. */
function summary(st: App['state']['data']['settings']): string {
  if (!st.bpm) return 'No BPM set';
  const parts = [`${st.bpm} BPM`, `${st.beatsPerBar} beats/bar`, st.metronomeOn ? 'click ON' : 'click off'];
  const ci = [st.countInOnStart && 'play', st.countInOnRepeat && 'each loop'].filter(Boolean);
  parts.push(ci.length ? `count-in ${st.countInBeats} (${ci.join(', ')})` : 'no count-in');
  return parts.join(' · ');
}

function onNumber(input: HTMLInputElement, apply: (v: number | null) => void, allowEmpty = false): void {
  const read = () => {
    const raw = input.value.trim();
    if (raw === '') return allowEmpty ? apply(null) : undefined;
    const v = Number(raw);
    if (Number.isFinite(v)) apply(v);
  };
  input.addEventListener('change', read);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
