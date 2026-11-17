/** Shared data types. */

export interface Section {
  id: string;
  name: string;
  /** Song time in seconds (original speed). */
  start: number;
  end: number;
}

/** Settings stored per song (restored when the same song is opened again). */
export interface SongSettings {
  bpm: number | null;
  beatsPerBar: number;
  /** Song time (s) of a downbeat ("beat 1"); the beat grid is built from it. */
  beatOffset: number;
  speed: number;
  metronomeOn: boolean;
  clickFollowsSpeed: boolean;
  countInBeats: number;
  countInOnStart: boolean;
  countInOnRepeat: boolean;
}

/** Everything saved for one song. */
export interface SongData {
  settings: SongSettings;
  sections: Section[];
  /** The section that is selected (and looped when looping is on). */
  activeSectionId: string | null;
  loopOn: boolean;
}

/** Settings shared by all songs. */
export interface GlobalSettings {
  clickVolume: number;
  songVolume: number;
}

export interface LoadedSong {
  /** Content hash of the file; identifies the song for saving. */
  id: string;
  fileName: string;
  duration: number;
  decoder: 'native' | 'ffmpeg';
}

/** A range selected on the waveform (not yet a section). */
export interface Selection {
  start: number;
  end: number;
}
