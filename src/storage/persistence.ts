/**
 * Automatic saving in the browser (localStorage). Each song's data is stored
 * under its content ID; global settings (volumes) under one key.
 * Nothing is ever sent over the network.
 */
import { DEFAULT_GLOBAL_SETTINGS, STORAGE_PREFIX } from '../config';
import type { GlobalSettings, SongData } from '../state/types';
import { sanitizeSongData } from './sanitize';

const songKey = (id: string) => `${STORAGE_PREFIX}song:${id}`;
const GLOBAL_KEY = `${STORAGE_PREFIX}global`;

interface StoredSong {
  fileName: string;
  savedAt: string;
  data: SongData;
}

export function loadSongData(id: string, songDuration: number): SongData | null {
  const raw = readJson(songKey(id)) as StoredSong | null;
  if (!raw || typeof raw !== 'object') return null;
  return sanitizeSongData(raw.data, songDuration);
}

export function saveSongData(id: string, fileName: string, data: SongData): void {
  const value: StoredSong = { fileName, savedAt: new Date().toISOString(), data };
  writeJson(songKey(id), value);
}

export function loadGlobalSettings(): GlobalSettings {
  const raw = readJson(GLOBAL_KEY) as Partial<GlobalSettings> | null;
  const vol = (x: unknown, d: number) => (typeof x === 'number' && x >= 0 && x <= 1 ? x : d);
  return {
    clickVolume: vol(raw?.clickVolume, DEFAULT_GLOBAL_SETTINGS.clickVolume),
    songVolume: vol(raw?.songVolume, DEFAULT_GLOBAL_SETTINGS.songVolume),
  };
}

export function saveGlobalSettings(g: GlobalSettings): void {
  writeJson(GLOBAL_KEY, g);
}

/** Small UI preferences (e.g. which panels are open), stored per browser. */
export function loadUiFlag(name: string, fallback: boolean): boolean {
  const v = readJson(`${STORAGE_PREFIX}ui:${name}`);
  return typeof v === 'boolean' ? v : fallback;
}

export function saveUiFlag(name: string, value: boolean): void {
  writeJson(`${STORAGE_PREFIX}ui:${name}`, value);
}

function readJson(key: string): unknown {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null; // storage disabled or corrupt entry
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('Could not save to localStorage', e);
  }
}
