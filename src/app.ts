/**
 * The app controller: owns the store, the audio engine and persistence, and
 * exposes the actions the UI calls (open file, play, add section, ...).
 * UI modules never talk to the audio engine directly.
 */
import { SEEK_STEP, SPEED_RANGE } from './config';
import { decodeAudioFile } from './audio/decode/decodeAudioFile';
import { Player, type TimingSettings } from './audio/player';
import { MIN_LOOP_SEC } from './audio/playbackPlan';
import { SpeedController } from './audio/speedController';
import { createTimeStretcher } from './audio/timeStretch';
import * as sec from './sections/sections';
import { defaultSongData, Store, type AppState } from './state/store';
import type { GlobalSettings, Selection, SongSettings } from './state/types';
import { buildExport, downloadText, exportFileName, parseImport } from './storage/exportImport';
import { loadGlobalSettings, loadSongData, saveGlobalSettings, saveSongData } from './storage/persistence';
import { computeSongId } from './storage/songId';

/** The region that is looped right now (active section, else the selection), or null. */
export function loopRegion(s: AppState): Selection | null {
  if (!s.data.loopOn) return null;
  const active = s.data.sections.find((x) => x.id === s.data.activeSectionId);
  if (active) return { start: active.start, end: active.end };
  if (s.selection && s.selection.end - s.selection.start >= MIN_LOOP_SEC) return s.selection;
  return null;
}

function timingFromState(s: AppState): TimingSettings {
  const st = s.data.settings;
  return {
    loop: loopRegion(s),
    bpm: st.bpm,
    beatOffset: st.beatOffset,
    beatsPerBar: st.beatsPerBar,
    clickFollowsSpeed: st.clickFollowsSpeed,
    countInBeats: st.countInBeats,
    countInOnStart: st.countInOnStart,
    countInOnRepeat: st.countInOnRepeat,
  };
}

export class App {
  readonly store = new Store();
  /** Created on first file open (browsers want a user action before audio starts). */
  player: Player | null = null;
  /** The decoded original audio of the current song. */
  original: AudioBuffer | null = null;
  private speedCtl: SpeedController | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private tapTimes: number[] = [];
  private audioListeners = new Set<(buffer: AudioBuffer | null) => void>();

  constructor() {
    this.store.update((s) => ({ ...s, global: loadGlobalSettings() }));
    this.store.subscribe((s, prev) => this.syncEngine(s, prev));
    this.store.subscribe((s, prev) => this.scheduleSave(s, prev));
  }

  /** UI hook: called when a new song's audio is loaded. */
  onAudioLoaded(fn: (buffer: AudioBuffer | null) => void): void {
    this.audioListeners.add(fn);
  }

  get state(): AppState {
    return this.store.state;
  }

  // ------------------------------------------------------------ files

  async openFile(file: File): Promise<void> {
    const store = this.store;
    this.player?.pause();
    store.update((s) => ({ ...s, loading: true, status: { message: `Opening “${file.name}”…`, kind: 'info' } }));
    try {
      const { player, speedCtl } = this.ensureAudio();
      const bytes = await file.arrayBuffer();
      const [id, decoded] = await Promise.all([
        computeSongId(bytes),
        decodeAudioFile(player.ctx, bytes, file.name, (message) =>
          store.update((s) => ({ ...s, status: { message, kind: 'info' } })),
        ),
      ]);
      const buffer = decoded.buffer;
      const saved = loadSongData(id, buffer.duration);
      this.original = buffer;
      player.load(buffer);
      speedCtl.setSource(buffer);
      for (const fn of this.audioListeners) fn(buffer);
      const data = saved ?? defaultSongData();
      store.update((s) => ({
        ...s,
        song: { id, fileName: file.name, duration: buffer.duration, decoder: decoded.decoder },
        data,
        selection: null,
        loading: false,
        status: {
          message: saved
            ? `Loaded “${file.name}” — restored ${data.sections.length} section(s) and settings.`
            : `Loaded “${file.name}”.`,
          kind: 'info',
        },
      }));
      if (data.settings.speed !== 1) void this.applySpeed(data.settings.speed);
    } catch (e) {
      console.error(e);
      store.update((s) => ({
        ...s,
        loading: false,
        status: { message: `Could not open “${file.name}”: ${(e as Error).message || e}`, kind: 'error' },
      }));
    }
  }

  exportPractice(): void {
    const { song, data } = this.state;
    if (!song) return;
    downloadText(exportFileName(song.fileName), buildExport(song, data));
    this.setStatus(`Exported sections and settings to ${exportFileName(song.fileName)}.`);
  }

  async importPractice(file: File): Promise<void> {
    const song = this.state.song;
    if (!song) {
      this.setStatus('Open the song first, then import its practice file.', 'error');
      return;
    }
    try {
      const parsed = parseImport(await file.text(), song.duration);
      if (parsed.song && parsed.song.id !== song.id) {
        const ok = confirm(
          `This practice file was made for “${parsed.song.fileName}”, which is a different file than “${song.fileName}”.\n\nApply it anyway? (Fine if it's the same song in another format.)`,
        );
        if (!ok) return;
      }
      const speedChanged = parsed.data.settings.speed !== this.state.data.settings.speed;
      this.store.update((s) => ({ ...s, data: parsed.data, selection: null }));
      if (speedChanged) void this.applySpeed(parsed.data.settings.speed);
      this.setStatus(`Imported ${parsed.data.sections.length} section(s) and settings.`);
    } catch (e) {
      this.setStatus((e as Error).message, 'error');
    }
  }

  // ------------------------------------------------------------ transport

  togglePlay(): void {
    this.player?.toggle();
  }

  seek(time: number): void {
    this.player?.seek(time);
  }

  seekBy(delta: number): void {
    if (this.player) this.player.seek(this.player.position + delta);
  }

  seekSmall(dir: 1 | -1, large = false): void {
    this.seekBy(dir * (large ? SEEK_STEP.large : SEEK_STEP.small));
  }

  /** Go to the start of the loop/active section, or the song start. */
  goToStart(): void {
    const region = loopRegion(this.state) ?? this.activeSection();
    this.seek(region ? region.start : 0);
  }

  toggleLoop(): void {
    const s = this.state;
    if (!s.data.loopOn && !this.activeSection() && !s.selection) {
      this.setStatus('Select a range or pick a section to loop.', 'error');
      return;
    }
    this.store.update((st) => ({ ...st, data: { ...st.data, loopOn: !st.data.loopOn } }));
    // When turning the loop on while outside it, jump to its start.
    const region = loopRegion(this.state);
    const pos = this.player?.position ?? 0;
    if (region && (pos < region.start || pos >= region.end)) this.seek(region.start);
  }

  // ------------------------------------------------------------ speed

  setSpeed(speed: number): void {
    const clamped = Math.round(Math.max(SPEED_RANGE.min, Math.min(SPEED_RANGE.max, speed)) * 1000) / 1000;
    if (clamped === this.state.data.settings.speed) return;
    this.store.updateSettings({ speed: clamped });
    void this.applySpeed(clamped);
  }

  private applySpeed(speed: number): Promise<void> {
    return this.speedCtl?.request(speed).catch((e) => this.setStatus(`Speed change failed: ${e}`, 'error')) ?? Promise.resolve();
  }

  // ------------------------------------------------------------ settings

  updateSettings(patch: Partial<SongSettings>): void {
    this.store.updateSettings(patch);
  }

  updateGlobal(patch: Partial<GlobalSettings>): void {
    this.store.update((s) => ({ ...s, global: { ...s.global, ...patch } }));
  }

  toggleMetronome(): void {
    const st = this.state.data.settings;
    if (!st.bpm) {
      this.setStatus('Type the song’s BPM first (Metronome panel).', 'error');
      return;
    }
    this.updateSettings({ metronomeOn: !st.metronomeOn });
  }

  toggleCountIn(): void {
    const st = this.state.data.settings;
    if (!st.bpm) {
      this.setStatus('Type the song’s BPM first (Metronome panel).', 'error');
      return;
    }
    this.updateSettings({ countInOnStart: !st.countInOnStart });
  }

  /** Make "beat 1" fall exactly at the current playhead. */
  setBeatOneAtPlayhead(): void {
    if (!this.player) return;
    this.updateSettings({ beatOffset: round4(this.player.position) });
  }

  nudgeBeatOffset(ms: number): void {
    this.updateSettings({ beatOffset: round4(this.state.data.settings.beatOffset + ms / 1000) });
  }

  /** Tap tempo: average of the last few tap intervals. */
  tapTempo(): void {
    const now = performance.now();
    if (this.tapTimes.length && now - this.tapTimes[this.tapTimes.length - 1] > 2000) this.tapTimes = [];
    this.tapTimes.push(now);
    this.tapTimes = this.tapTimes.slice(-8);
    if (this.tapTimes.length >= 3) {
      const span = this.tapTimes[this.tapTimes.length - 1] - this.tapTimes[0];
      const bpm = (60000 * (this.tapTimes.length - 1)) / span;
      this.updateSettings({ bpm: Math.round(bpm * 10) / 10 });
    }
  }

  // ------------------------------------------------------------ sections

  activeSection() {
    const d = this.state.data;
    return d.sections.find((s) => s.id === d.activeSectionId) ?? null;
  }

  setSelection(sel: Selection | null): void {
    this.store.update((s) => ({ ...s, selection: sel && sel.end - sel.start > 0.01 ? sel : null }));
  }

  /** Create a section from the current selection. Returns its id. */
  addSectionFromSelection(name?: string): string | null {
    const sel = this.state.selection;
    if (!sel) {
      this.setStatus('Drag on the waveform to select a range first.', 'error');
      return null;
    }
    const { sections, section } = sec.addSection(this.state.data.sections, sel.start, sel.end, name);
    this.store.update((s) => ({
      ...s,
      selection: null,
      data: { ...s.data, sections, activeSectionId: section.id },
    }));
    return section.id;
  }

  renameSection(id: string, name: string): void {
    this.store.update((s) => ({ ...s, data: { ...s.data, sections: sec.renameSection(s.data.sections, id, name) } }));
  }

  resizeSection(id: string, edge: 'start' | 'end', time: number): void {
    const duration = this.state.song?.duration ?? 0;
    this.store.update((s) => ({
      ...s,
      data: { ...s.data, sections: sec.resizeSection(s.data.sections, id, edge, time, duration) },
    }));
  }

  /** Set a section's start/end from typed values. */
  setSectionTimes(id: string, start: number, end: number): void {
    const duration = this.state.song?.duration ?? 0;
    let sections = sec.resizeSection(this.state.data.sections, id, 'end', Math.max(start, end), duration);
    sections = sec.resizeSection(sections, id, 'start', Math.min(start, end), duration);
    this.store.update((s) => ({ ...s, data: { ...s.data, sections } }));
  }

  deleteSection(id: string): void {
    this.store.update((s) => ({
      ...s,
      data: {
        ...s.data,
        sections: sec.deleteSection(s.data.sections, id),
        activeSectionId: s.data.activeSectionId === id ? null : s.data.activeSectionId,
      },
    }));
  }

  /** Make a section active and jump to its start. */
  activateSection(id: string, jump = true): void {
    const section = this.state.data.sections.find((s) => s.id === id);
    if (!section) return;
    this.store.update((s) => ({ ...s, selection: null, data: { ...s.data, activeSectionId: id } }));
    if (jump) this.seek(section.start);
  }

  activateAdjacent(dir: 1 | -1): void {
    const next = sec.adjacentSection(this.state.data.sections, this.state.data.activeSectionId, dir);
    if (next) this.activateSection(next.id);
  }

  activateByIndex(index: number): void {
    const s = sec.sortSections(this.state.data.sections)[index];
    if (s) this.activateSection(s.id);
  }

  clearSelection(): void {
    if (this.state.selection) this.setSelection(null);
    else if (this.state.data.activeSectionId)
      this.store.update((s) => ({ ...s, data: { ...s.data, activeSectionId: null } }));
  }

  // ------------------------------------------------------------ internals

  setStatus(message: string, kind: 'info' | 'error' = 'info'): void {
    this.store.update((s) => ({ ...s, status: { message, kind } }));
  }

  private ensureAudio(): { player: Player; speedCtl: SpeedController } {
    if (!this.player || !this.speedCtl) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const player = new Player(ctx);
      this.player = player;
      this.speedCtl = new SpeedController(
        ctx,
        createTimeStretcher(),
        (buffer, speed) => player.setPlayBuffer(buffer, speed),
        (p) => this.store.update((s) => ({ ...s, stretchProgress: p })),
      );
      this.syncEngine(this.state, null);
    }
    return { player: this.player, speedCtl: this.speedCtl };
  }

  /** Push state changes into the audio engine. */
  private syncEngine(s: AppState, prev: AppState | null): void {
    const p = this.player;
    if (!p) return;
    p.setTiming(timingFromState(s));
    if (!prev || prev.data.settings.metronomeOn !== s.data.settings.metronomeOn)
      p.setMetronomeOn(s.data.settings.metronomeOn);
    if (!prev || prev.global !== s.global) p.setVolumes(s.global.songVolume, s.global.clickVolume);
  }

  /** Save (debounced) whenever song data or global settings change. */
  private scheduleSave(s: AppState, prev: AppState): void {
    if (s.global !== prev.global) saveGlobalSettings(s.global);
    if (!s.song || s.data === prev.data || s.song !== prev.song) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const song = s.song;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.state.song === song) saveSongData(song.id, song.fileName, this.state.data);
    }, 300);
  }

  /** Save immediately (e.g. before the page closes). */
  flushSave(): void {
    const s = this.state;
    if (this.saveTimer && s.song) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      saveSongData(s.song.id, s.song.fileName, s.data);
    }
  }
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
