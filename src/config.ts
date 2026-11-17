/**
 * App-wide tunable values. Change things here rather than hunting through the code.
 */

/**
 * Playback speed range (1 = original speed). Widen `min` (e.g. to 0.5) once a
 * higher-quality time-stretch engine is plugged in — see src/audio/timeStretch/.
 */
export const SPEED_RANGE = { min: 0.7, max: 1.0 } as const;

/** Step used by the speed -/+ buttons and the arrow-key shortcuts. */
export const SPEED_STEP = 0.05;

/** Quick-pick speed buttons (only those inside SPEED_RANGE are shown). */
export const SPEED_PRESETS = [0.7, 0.75, 0.8, 0.85, 0.9, 1.0];

/** Defaults for a song that has never been opened before. */
export const DEFAULT_SONG_SETTINGS = {
  bpm: null as number | null, // unknown until the user types it in
  beatsPerBar: 4,
  /** Time (seconds, in the original song) of a downbeat ("beat 1"). */
  beatOffset: 0,
  speed: 1,
  metronomeOn: false,
  /** true: click follows the song's slowed tempo. false: click stays at the typed BPM. */
  clickFollowsSpeed: true,
  countInBeats: 4,
  countInOnStart: false,
  countInOnRepeat: false,
};

/** Defaults for settings that are global (not per song). */
export const DEFAULT_GLOBAL_SETTINGS = {
  clickVolume: 0.7, // 0..1
  songVolume: 1.0, // 0..1
};

/** Waveform zoom limits, in pixels per second. */
export const ZOOM = { maxPxPerSec: 2000, step: 1.5 };

/** Seek amounts for the arrow keys (seconds). */
export const SEEK_STEP = { small: 2, large: 10 };

/** Length of the tiny cross-fade at loop boundaries and starts/stops (seconds). */
export const FADE_SEC = 0.003;

/** How far ahead (seconds) the scheduler queues audio and clicks. */
export const SCHEDULE_AHEAD_SEC = 1.0;
/** How often (ms) the scheduler wakes up to queue more events. */
export const SCHEDULER_INTERVAL_MS = 50;

/** Prefix for everything this app stores in localStorage. */
export const STORAGE_PREFIX = 'practice-player:';
