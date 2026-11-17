/**
 * Validates data coming from localStorage or an imported file. Anything
 * missing or invalid falls back to defaults, so old or hand-edited files
 * never break the app.
 */
import { DEFAULT_SONG_SETTINGS, SPEED_RANGE } from '../config';
import type { Section, SongData, SongSettings } from '../state/types';

export function sanitizeSongData(raw: unknown, songDuration = Infinity): SongData {
  const r = isObj(raw) ? raw : {};
  const settings = sanitizeSettings(r.settings);
  const sections = Array.isArray(r.sections)
    ? r.sections.map((s) => sanitizeSection(s, songDuration)).filter((s): s is Section => s !== null)
    : [];
  const activeSectionId =
    typeof r.activeSectionId === 'string' && sections.some((s) => s.id === r.activeSectionId) ? r.activeSectionId : null;
  return { settings, sections, activeSectionId, loopOn: r.loopOn === true };
}

function sanitizeSettings(raw: unknown): SongSettings {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_SONG_SETTINGS;
  return {
    bpm: num(r.bpm, 20, 400) ?? d.bpm,
    beatsPerBar: Math.round(num(r.beatsPerBar, 1, 16) ?? d.beatsPerBar),
    beatOffset: num(r.beatOffset, -3600, 36000) ?? d.beatOffset,
    speed: num(r.speed, SPEED_RANGE.min, SPEED_RANGE.max) ?? d.speed,
    metronomeOn: bool(r.metronomeOn) ?? d.metronomeOn,
    clickFollowsSpeed: bool(r.clickFollowsSpeed) ?? d.clickFollowsSpeed,
    countInBeats: Math.round(num(r.countInBeats, 0, 16) ?? d.countInBeats),
    countInOnStart: bool(r.countInOnStart) ?? d.countInOnStart,
    countInOnRepeat: bool(r.countInOnRepeat) ?? d.countInOnRepeat,
  };
}

function sanitizeSection(raw: unknown, songDuration: number): Section | null {
  if (!isObj(raw)) return null;
  const start = num(raw.start, 0, songDuration);
  const end = num(raw.end, 0, songDuration);
  if (start === null || end === null || end - start < 0.01) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    name: typeof raw.name === 'string' ? raw.name.slice(0, 100) : 'Section',
    start,
    end,
  };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function num(x: unknown, min: number, max: number): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : null;
}
function bool(x: unknown): boolean | null {
  return typeof x === 'boolean' ? x : null;
}
