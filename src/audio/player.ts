/**
 * The audio engine: plays the song and the clicks on the AudioContext clock.
 *
 * - `playbackPlan` (pure) decides WHEN things happen.
 * - This class turns plan events into Web Audio nodes, a little ahead of time
 *   ("lookahead scheduling"): a timer wakes up every ~50 ms and queues
 *   everything due within the next second with sample-accurate start times.
 *   The timer itself can be late without affecting timing.
 * - Song audio comes from `playBuffer`: the original AudioBuffer at 100%
 *   speed, or a time-stretched copy at other speeds (see ../speed handling in
 *   app.ts). Output time t inside a segment maps to buffer time songTime/speed.
 *
 * Graph:  song sources -> per-source fade gain -> songBus -> destination
 *         metronome clicks -> metronomeGate -> clickBus -> destination
 *         count-in clicks  -----------------> clickBus
 */
import { FADE_SEC, SCHEDULE_AHEAD_SEC, SCHEDULER_INTERVAL_MS } from '../config';
import { playbackPlan, type AudioEvent, type ClickEvent, type PlanEvent, type PlanInput } from './playbackPlan';
import { createClickSounds, type ClickSounds } from './clickSounds';

/** The plan settings the app controls (everything except position/speed/song facts). */
export type TimingSettings = Omit<PlanInput, 'startPos' | 'songDuration' | 'speed' | 'sampleRate'>;

interface ScheduledAudio {
  src: AudioBufferSourceNode;
  gain: GainNode;
  start: number; // ctx time
  end: number; // ctx time the segment ends (fade-out tail continues FADE_SEC beyond)
}

interface ScheduledClick {
  src: AudioBufferSourceNode;
  time: number;
  ev: ClickEvent;
}

/** A stretch of song audio on the ctx clock, used to know "where are we in the song". */
interface TimelineSegment {
  ctxStart: number;
  ctxEnd: number;
  songStart: number;
  speed: number;
}

export interface BeatInfo {
  beatInBar: number;
  countIn: boolean;
  countInNumber: number;
  /** ctx time of that click */
  time: number;
}

export class Player {
  readonly ctx: AudioContext;
  /** Song volume. Public so tests can tap the signal. */
  readonly songBus: GainNode;
  /** Click volume (metronome and count-in). Public so tests can tap the signal. */
  readonly clickBus: GainNode;
  private metronomeGate: GainNode;
  private sounds: ClickSounds;

  private source: AudioBuffer | null = null;
  private playBuffer: AudioBuffer | null = null;
  private speed = 1;
  private timing: TimingSettings = {
    loop: null,
    bpm: null,
    beatOffset: 0,
    beatsPerBar: 4,
    clickFollowsSpeed: true,
    countInBeats: 4,
    countInOnStart: false,
    countInOnRepeat: false,
  };

  private playing = false;
  private pausedPos = 0;

  private plan: Generator<PlanEvent, void, void> | null = null;
  private pendingEvent: PlanEvent | null = null;
  private planBase = 0; // ctx time of plan time 0
  private planSpeed = 1;
  private planStartPos = 0;
  private endTime: number | null = null;
  private audioNodes: ScheduledAudio[] = [];
  private clickNodes: ScheduledClick[] = [];
  private timeline: TimelineSegment[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.songBus = ctx.createGain();
    this.clickBus = ctx.createGain();
    this.metronomeGate = ctx.createGain();
    this.metronomeGate.gain.value = 0;
    this.metronomeGate.connect(this.clickBus);
    this.songBus.connect(ctx.destination);
    this.clickBus.connect(ctx.destination);
    this.sounds = createClickSounds(ctx);
  }

  // ---------------------------------------------------------------- setup

  /** Load a new song (stops playback). */
  load(buffer: AudioBuffer): void {
    this.stopEverything();
    this.source = buffer;
    this.playBuffer = buffer;
    this.speed = 1;
    this.pausedPos = 0;
    this.emit();
  }

  get duration(): number {
    return this.source?.duration ?? 0;
  }

  /**
   * Switch to a (time-stretched) buffer for `speed`. If playing, the switch
   * happens seamlessly at the current song position.
   */
  setPlayBuffer(buffer: AudioBuffer, speed: number): void {
    this.playBuffer = buffer;
    this.speed = speed;
    if (this.playing) this.replan();
  }

  get currentSpeed(): number {
    return this.speed;
  }

  /** The buffer used for playback right now (time-stretched unless speed is 100%). */
  get currentBuffer(): AudioBuffer | null {
    return this.playBuffer;
  }

  /** Update loop / BPM / count-in settings. Takes effect immediately when playing. */
  setTiming(timing: TimingSettings): void {
    const changed = JSON.stringify(timing) !== JSON.stringify(this.timing);
    this.timing = { ...timing };
    if (changed && this.playing) this.replan();
  }

  setMetronomeOn(on: boolean): void {
    this.metronomeGate.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.005);
  }

  setVolumes(song: number, click: number): void {
    this.songBus.gain.setTargetAtTime(song, this.ctx.currentTime, 0.01);
    this.clickBus.gain.setTargetAtTime(click, this.ctx.currentTime, 0.01);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------------------------------------------------------------- transport

  get isPlaying(): boolean {
    return this.playing;
  }

  async play(): Promise<void> {
    if (!this.source || this.playing) return;
    this.playing = true; // set first so a double-press can't start twice
    await this.ctx.resume();
    if (!this.playing) return; // paused while resuming
    if (this.pausedPos >= this.duration - 0.01) this.pausedPos = 0;
    this.startPlan(this.pausedPos, this.timing.countInOnStart, this.nextSafeTime());
    this.timer = setInterval(() => this.tick(), SCHEDULER_INTERVAL_MS);
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedPos = this.position;
    this.stopEverything();
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else void this.play();
  }

  /** Jump to song time `pos`. While playing, continues from there (no count-in). */
  seek(pos: number): void {
    pos = Math.max(0, Math.min(pos, this.duration));
    if (!this.playing) {
      this.pausedPos = pos;
      this.emit();
      return;
    }
    const t = this.nextSafeTime();
    this.cancelFrom(t);
    this.startPlan(pos, false, t);
  }

  /** Current song position (seconds), as heard (corrected for output latency). */
  get position(): number {
    if (!this.playing) return this.pausedPos;
    return this.positionAt(this.audibleTime());
  }

  /** The most recent click that has been heard (for the beat indicator). */
  get lastBeat(): BeatInfo | null {
    if (!this.playing) return null;
    const t = this.audibleTime();
    let best: ScheduledClick | null = null;
    for (const c of this.clickNodes) if (c.time <= t) best = c;
    if (!best) return null;
    // Reported even when the metronome is muted: the visual beat indicator is still useful.
    return { beatInBar: best.ev.beatInBar, countIn: best.ev.countIn, countInNumber: best.ev.countInNumber, time: best.time };
  }

  /** True while a count-in is sounding (song not yet playing). */
  get inCountIn(): boolean {
    const b = this.lastBeat;
    if (!b || !b.countIn) return false;
    const t = this.audibleTime();
    return !this.timeline.some((s) => s.ctxStart <= t && t < s.ctxEnd);
  }

  // ---------------------------------------------------------------- internals

  private audibleTime(): number {
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return this.ctx.currentTime - latency;
  }

  /** A ctx time slightly in the future, on a whole sample frame. */
  private nextSafeTime(): number {
    const sr = this.ctx.sampleRate;
    return Math.ceil((this.ctx.currentTime + 0.05) * sr) / sr;
  }

  private positionAt(t: number): number {
    let seg: TimelineSegment | null = null;
    for (const s of this.timeline) {
      if (s.ctxStart <= t) seg = s;
      else break;
    }
    if (seg && t < seg.ctxEnd) return seg.songStart + (t - seg.ctxStart) * seg.speed;
    // Between segments: during a count-in show where the song will start.
    let countIn: ScheduledClick | null = null;
    for (const c of this.clickNodes) {
      if (c.time > t) break;
      if (c.ev.countIn && (!seg || c.time >= seg.ctxEnd - 1e-6)) countIn = c;
    }
    if (countIn) return countIn.ev.nextSongPos;
    if (seg) return seg.songStart + (seg.ctxEnd - seg.ctxStart) * seg.speed;
    return this.planStartPos;
  }

  private startPlan(startPos: number, countInOnStart: boolean, base: number): void {
    if (!this.source) return;
    this.planBase = base;
    this.planSpeed = this.speed;
    this.planStartPos = startPos;
    this.endTime = null;
    this.pendingEvent = null;
    this.plan = playbackPlan({
      ...this.timing,
      countInOnStart,
      startPos,
      songDuration: this.source.duration,
      speed: this.speed,
      sampleRate: this.ctx.sampleRate,
    });
    this.tick();
  }

  /** Restart the plan from the current position, seamlessly (settings changed). */
  private replan(): void {
    const t = this.nextSafeTime();
    const pos = this.positionAt(t);
    this.cancelFrom(t);
    this.startPlan(pos, false, t);
  }

  /** Queue every plan event that is due within the lookahead window. */
  private tick(): void {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    const horizon = now + SCHEDULE_AHEAD_SEC;
    while (this.plan) {
      if (!this.pendingEvent) {
        const r = this.plan.next();
        if (r.done) {
          this.plan = null;
          break;
        }
        this.pendingEvent = r.value;
      }
      const ev = this.pendingEvent;
      const when = this.planBase + ev.time;
      if (when > horizon) break;
      this.pendingEvent = null;
      if (ev.type === 'audio') this.scheduleAudio(ev, when);
      else if (ev.type === 'click') this.scheduleClick(ev, when);
      else this.endTime = when;
    }

    if (this.endTime !== null && now >= this.endTime) {
      this.pausedPos = this.duration;
      this.stopEverything();
      this.emit();
      return;
    }

    // Forget nodes that finished a while ago (keep the latest segment for positionAt).
    this.audioNodes = this.audioNodes.filter((n) => n.end + FADE_SEC > now - 1);
    this.clickNodes = this.clickNodes.filter((c) => c.time > now - 5);
    while (this.timeline.length > 1 && this.timeline[1].ctxEnd < now - 5) this.timeline.shift();
  }

  private scheduleAudio(ev: AudioEvent, when: number): void {
    const buf = this.playBuffer!;
    const offset = ev.songStart / this.planSpeed;
    const duration = ev.duration;
    // Keep playing a few ms past the end while fading out, so the next loop
    // repeat (which fades in at the same moment) cross-fades without a gap.
    const tail = Math.max(0, Math.min(FADE_SEC, buf.duration - offset - duration));
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(1, when + FADE_SEC);
    gain.gain.setValueAtTime(1, when + duration);
    gain.gain.linearRampToValueAtTime(0, when + duration + tail);
    src.connect(gain).connect(this.songBus);
    src.start(when, offset, duration + tail);
    this.audioNodes.push({ src, gain, start: when, end: when + duration });
    this.timeline.push({ ctxStart: when, ctxEnd: when + duration, songStart: ev.songStart, speed: this.planSpeed });
  }

  private scheduleClick(ev: ClickEvent, when: number): void {
    const down = ev.beatInBar === 0;
    const src = this.ctx.createBufferSource();
    if (ev.countIn) {
      src.buffer = down ? this.sounds.countInAccent : this.sounds.countIn;
      src.connect(this.clickBus);
    } else {
      src.buffer = down ? this.sounds.accent : this.sounds.beat;
      src.connect(this.metronomeGate);
    }
    src.start(when);
    this.clickNodes.push({ src, time: when, ev });
  }

  /** Remove everything scheduled from ctx time `t` on; fade out audio that is playing across `t`. */
  private cancelFrom(t: number): void {
    for (const n of this.audioNodes) {
      if (n.start >= t - 1e-9) {
        stopNode(n.src);
      } else if (n.end + FADE_SEC > t) {
        n.gain.gain.cancelScheduledValues(t);
        n.gain.gain.setValueAtTime(1, t);
        n.gain.gain.linearRampToValueAtTime(0, t + FADE_SEC);
        try {
          n.src.stop(t + FADE_SEC);
        } catch {
          /* already stopped */
        }
      }
    }
    this.audioNodes = this.audioNodes.filter((n) => n.start < t - 1e-9);
    for (const c of this.clickNodes) if (c.time >= t) stopNode(c.src);
    this.clickNodes = this.clickNodes.filter((c) => c.time < t);
    this.timeline = this.timeline.filter((s) => s.ctxStart < t);
    for (const s of this.timeline) s.ctxEnd = Math.min(s.ctxEnd, t);
    this.plan = null;
    this.pendingEvent = null;
    this.endTime = null;
  }

  private stopEverything(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.cancelFrom(this.ctx.currentTime);
    this.timeline = [];
    this.clickNodes = [];
    this.playing = false;
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

function stopNode(src: AudioScheduledSourceNode): void {
  try {
    src.stop();
  } catch {
    /* never started or already stopped */
  }
  src.disconnect();
}
