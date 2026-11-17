/**
 * Playback planning: works out WHEN each piece of song audio and each click
 * should sound. Pure function, no Web Audio, so it is easy to unit-test.
 *
 * Two time axes are involved:
 *  - "song time": seconds in the original recording (sections, beat grid).
 *  - "output time": seconds of playback, relative to the moment the plan
 *    starts (the player adds the AudioContext time). At speed s, one second of
 *    song takes 1/s seconds of output.
 *
 * The plan is an endless (when looping) sequence of events in time order:
 *  - 'audio': play song time [songStart, songEnd) starting at output `time`.
 *  - 'click': a metronome or count-in click at output `time`.
 *  - 'end':   playback reached the end of the song.
 *
 * Why this gives tight, drift-free loops and clicks:
 *  - Every repeat's start is computed from whole sample frames (integers), so
 *    loop repeats butt up against each other exactly, forever.
 *  - Clicks are derived from the song's beat grid inside each segment (not
 *    from a free-running timer), so they can't drift away from the music.
 */

export interface PlanInput {
  /** Song time where playback starts. */
  startPos: number;
  songDuration: number;
  speed: number;
  sampleRate: number;
  /** Loop region in song time, or null for no looping. */
  loop: { start: number; end: number } | null;
  /** Song tempo; null = unknown (no clicks, no count-in). */
  bpm: number | null;
  /** Song time of a downbeat ("beat 1"); the beat grid is built from it. */
  beatOffset: number;
  beatsPerBar: number;
  /** true: click tempo follows playback speed. false: click stays at `bpm`. */
  clickFollowsSpeed: boolean;
  countInBeats: number;
  countInOnStart: boolean;
  countInOnRepeat: boolean;
}

export interface AudioEvent {
  type: 'audio';
  time: number;
  songStart: number;
  songEnd: number;
  /** Output duration in seconds (an exact whole number of sample frames). */
  duration: number;
  /** 0 for the first pass, 1.. for loop repeats. */
  repeat: number;
}

export interface ClickEvent {
  type: 'click';
  time: number;
  /** Position in the bar (0 = downbeat). */
  beatInBar: number;
  countIn: boolean;
  /** For count-in clicks: 1..countInBeats. */
  countInNumber: number;
  /** For count-in clicks: song time that will start playing after the count-in. */
  nextSongPos: number;
}

export interface EndEvent {
  type: 'end';
  time: number;
}

export type PlanEvent = AudioEvent | ClickEvent | EndEvent;

const EPS = 1e-6;

/** Smallest loop we accept (shorter regions are treated as "no loop"). */
export const MIN_LOOP_SEC = 0.05;

export function* playbackPlan(p: PlanInput): Generator<PlanEvent, void, void> {
  const sr = p.sampleRate;
  const loop = p.loop && p.loop.end - p.loop.start >= MIN_LOOP_SEC ? p.loop : null;

  let pos = Math.max(0, Math.min(p.startPos, p.songDuration));
  // Starting at/after the loop end jumps back to the loop start.
  if (loop && pos >= loop.end - EPS) pos = loop.start;

  let frame = 0; // output position, in whole sample frames
  let repeat = 0;
  for (;;) {
    const segEnd = loop && pos < loop.end ? loop.end : p.songDuration;
    if (segEnd - pos <= EPS) {
      yield { type: 'end', time: frame / sr };
      return;
    }
    const countIn = repeat === 0 ? p.countInOnStart : p.countInOnRepeat;
    const seg = planSegment(p, frame, pos, segEnd, countIn, repeat);
    yield* seg.events;
    frame = seg.endFrame;

    if (!loop) {
      yield { type: 'end', time: frame / sr };
      return;
    }
    pos = loop.start;
    repeat++;
  }
}

/**
 * Events for one continuous stretch of song audio (optionally preceded by a
 * count-in), starting at output frame `startFrame`.
 */
function planSegment(
  p: PlanInput,
  startFrame: number,
  songStart: number,
  songEnd: number,
  withCountIn: boolean,
  repeat: number,
): { events: PlanEvent[]; endFrame: number } {
  const sr = p.sampleRate;
  const events: PlanEvent[] = [];
  const grid = beatGrid(p, songStart);

  // Count-in: N clicks that lead into the first beat of the segment. If the
  // segment starts a little before a beat (a pickup), that audio overlaps the
  // last count-in beat, exactly as if the band had counted you in.
  let audioFrame = startFrame;
  if (grid && withCountIn && p.countInBeats > 0) {
    const n = p.countInBeats;
    let gap = n * grid.clickPeriod - grid.lead;
    if (gap < 0) gap += Math.ceil(-gap / grid.clickPeriod) * grid.clickPeriod;
    audioFrame = startFrame + Math.round(gap * sr);
    const anchor = audioFrame / sr + grid.lead;
    for (let i = n; i >= 1; i--) {
      events.push({
        type: 'click',
        time: anchor - i * grid.clickPeriod,
        beatInBar: mod(grid.firstBeatInBar - i, p.beatsPerBar),
        countIn: true,
        countInNumber: n - i + 1,
        nextSongPos: songStart,
      });
    }
  }

  const durationFrames = Math.max(1, Math.round(((songEnd - songStart) / p.speed) * sr));
  const audioTime = audioFrame / sr;
  const endTime = (audioFrame + durationFrames) / sr;
  events.push({
    type: 'audio',
    time: audioTime,
    songStart,
    songEnd,
    duration: durationFrames / sr,
    repeat,
  });

  // Metronome clicks inside the segment, on the song's beat grid.
  if (grid) {
    const anchor = audioTime + grid.lead;
    for (let k = 0; ; k++) {
      const t = anchor + k * grid.clickPeriod;
      if (t >= endTime - EPS) break;
      events.push({
        type: 'click',
        time: t,
        beatInBar: mod(grid.firstBeatInBar + k, p.beatsPerBar),
        countIn: false,
        countInNumber: 0,
        nextSongPos: songStart,
      });
    }
  }

  events.sort((a, b) => a.time - b.time);
  return { events, endFrame: audioFrame + durationFrames };
}

/**
 * Beat grid information for a segment starting at song time `songStart`:
 *  - lead: output seconds from segment start to the first beat at/after it
 *  - clickPeriod: output seconds between clicks
 *  - firstBeatInBar: bar position of that first beat
 */
function beatGrid(p: PlanInput, songStart: number) {
  if (!p.bpm || p.bpm <= 0) return null;
  const beatLen = 60 / p.bpm; // song seconds per beat
  const n0 = Math.ceil((songStart - p.beatOffset) / beatLen - EPS);
  const firstBeat = p.beatOffset + n0 * beatLen;
  return {
    lead: (firstBeat - songStart) / p.speed,
    clickPeriod: p.clickFollowsSpeed ? beatLen / p.speed : beatLen,
    firstBeatInBar: mod(n0, p.beatsPerBar),
  };
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
