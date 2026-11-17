/**
 * The app state and a tiny observable store.
 *
 * All UI reads from `store.state` and changes it only through `store.update`.
 * Every update notifies subscribers, which re-render what they own. The state
 * is small, so "re-render on every change" stays simple and fast.
 */
import { DEFAULT_GLOBAL_SETTINGS, DEFAULT_SONG_SETTINGS } from '../config';
import type { GlobalSettings, LoadedSong, Selection, SongData } from './types';

export interface AppState {
  song: LoadedSong | null;
  data: SongData;
  global: GlobalSettings;
  selection: Selection | null;
  /** Status line shown to the user (loading, errors, ...). */
  status: { message: string; kind: 'info' | 'error' } | null;
  /** Time-stretch render progress 0..1, or null when idle. */
  stretchProgress: number | null;
  /** True while a file is being opened/decoded. */
  loading: boolean;
}

export function defaultSongData(): SongData {
  return { settings: { ...DEFAULT_SONG_SETTINGS }, sections: [], activeSectionId: null, loopOn: false };
}

type Listener = (state: AppState, prev: AppState) => void;

export class Store {
  private listeners = new Set<Listener>();
  state: AppState = {
    song: null,
    data: defaultSongData(),
    global: { ...DEFAULT_GLOBAL_SETTINGS },
    selection: null,
    status: null,
    stretchProgress: null,
    loading: false,
  };

  /** Apply a change. `fn` receives a copy-on-write draft: return the new state. */
  update(fn: (s: AppState) => AppState): void {
    const prev = this.state;
    this.state = fn(prev);
    for (const l of this.listeners) l(this.state, prev);
  }

  /** Convenience: change song settings. */
  updateSettings(patch: Partial<SongData['settings']>): void {
    this.update((s) => ({ ...s, data: { ...s.data, settings: { ...s.data.settings, ...patch } } }));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
