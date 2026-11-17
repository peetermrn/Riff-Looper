/**
 * Export/import of sections + settings as a small JSON file
 * ("<song>.practice.json") to share with friends alongside the song.
 */
import type { LoadedSong, SongData } from '../state/types';
import { sanitizeSongData } from './sanitize';

export const FILE_FORMAT = 'practice-player';
export const FILE_VERSION = 1;

export interface PracticeFile {
  format: typeof FILE_FORMAT;
  version: number;
  exportedAt: string;
  song: { fileName: string; id: string; duration: number };
  data: SongData;
}

export function buildExport(song: LoadedSong, data: SongData): string {
  const file: PracticeFile = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    exportedAt: new Date().toISOString(),
    song: { fileName: song.fileName, id: song.id, duration: round3(song.duration) },
    data,
  };
  return JSON.stringify(file, null, 2);
}

export function exportFileName(songFileName: string): string {
  return songFileName.replace(/\.[^.]+$/, '') + '.practice.json';
}

export interface ParsedImport {
  data: SongData;
  song: { fileName: string; id: string; duration: number } | null;
}

/** Parse an exported file. Throws an Error with a user-friendly message if invalid. */
export function parseImport(text: string, songDuration = Infinity): ParsedImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not a valid practice file (not JSON).');
  }
  const r = raw as Partial<PracticeFile>;
  if (!r || r.format !== FILE_FORMAT || typeof r.data !== 'object') {
    throw new Error('That file is not a practice file exported from this app.');
  }
  const s = r.song;
  const song =
    s && typeof s.fileName === 'string' && typeof s.id === 'string' && typeof s.duration === 'number'
      ? { fileName: s.fileName, id: s.id, duration: s.duration }
      : null;
  return { data: sanitizeSongData(r.data, songDuration), song };
}

/** Trigger a download of `text` as a file. */
export function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
