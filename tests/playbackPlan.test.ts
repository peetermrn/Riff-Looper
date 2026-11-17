import { describe, expect, it } from 'vitest';
import { playbackPlan, type PlanEvent, type PlanInput, type ClickEvent, type AudioEvent } from '../src/audio/playbackPlan';

const base: PlanInput = {
  startPos: 0,
  songDuration: 10,
  speed: 1,
  sampleRate: 48000,
  loop: null,
  bpm: 120,
  beatOffset: 0.25,
  beatsPerBar: 4,
  clickFollowsSpeed: true,
  countInBeats: 4,
  countInOnStart: false,
  countInOnRepeat: false,
};

/** Collect events until `maxTime` (plans with loops are endless). */
function collect(p: Partial<PlanInput>, maxTime = 1e9): PlanEvent[] {
  const out: PlanEvent[] = [];
  for (const ev of playbackPlan({ ...base, ...p })) {
    if (ev.time > maxTime) break;
    out.push(ev);
  }
  return out;
}
const clicks = (evs: PlanEvent[]) => evs.filter((e): e is ClickEvent => e.type === 'click');
const audio = (evs: PlanEvent[]) => evs.filter((e): e is AudioEvent => e.type === 'audio');

describe('playbackPlan', () => {
  it('plays to the end with clicks on the beat grid', () => {
    const evs = collect({});
    expect(audio(evs)).toEqual([{ type: 'audio', time: 0, songStart: 0, songEnd: 10, duration: 10, repeat: 0 }]);
    const c = clicks(evs);
    expect(c.length).toBe(20); // beats at 0.25, 0.75, ... 9.75
    c.forEach((ev, i) => expect(ev.time).toBeCloseTo(0.25 + i * 0.5, 9));
    expect(c.map((e) => e.beatInBar).slice(0, 5)).toEqual([0, 1, 2, 3, 0]);
    expect(evs.at(-1)).toEqual({ type: 'end', time: 10 });
  });

  it('events come in time order', () => {
    const evs = collect({ loop: { start: 1.1, end: 3.3 }, countInOnStart: true, countInOnRepeat: true }, 60);
    for (let i = 1; i < evs.length; i++) expect(evs[i].time).toBeGreaterThanOrEqual(evs[i - 1].time);
  });

  it('click follows the slowed song when clickFollowsSpeed', () => {
    const c = clicks(collect({ speed: 0.5 }));
    expect(c[0].time).toBeCloseTo(0.5, 9);
    expect(c[1].time - c[0].time).toBeCloseTo(1.0, 9);
  });

  it('click keeps the typed BPM when not following speed', () => {
    const c = clicks(collect({ speed: 0.5, clickFollowsSpeed: false }));
    expect(c[0].time).toBeCloseTo(0.5, 9); // first click still lands on the song's beat
    expect(c[1].time - c[0].time).toBeCloseTo(0.5, 9);
  });

  it('loops seamlessly on whole sample frames, forever', () => {
    const sr = 44100;
    const loop = { start: 1.2345, end: 3.4567 }; // deliberately not on beats/frames
    const evs = collect({ loop, sampleRate: sr, speed: 0.73 }, 2000);
    const a = audio(evs);
    expect(a.length).toBeGreaterThan(500);
    for (let i = 1; i < a.length; i++) {
      // Next repeat starts exactly where the previous one ended.
      expect(a[i].time).toBeCloseTo(a[i - 1].time + a[i - 1].duration, 9);
      // ...and on an integer sample frame (no accumulating rounding).
      const frame = a[i].time * sr;
      expect(Math.abs(frame - Math.round(frame))).toBeLessThan(1e-6);
    }
  });

  it('clicks stay on the song beat grid in every loop repeat', () => {
    const loop = { start: 1.1, end: 3.3 }; // 4.4 beats: not a whole number of beats
    const speed = 0.8;
    const evs = collect({ loop, speed, startPos: loop.start }, 300);
    const a = audio(evs);
    const c = clicks(evs);
    // Every click must map back to a song time on the beat grid.
    for (const click of c) {
      const seg = [...a].reverse().find((s) => s.time <= click.time + 1e-9)!;
      const songTime = seg.songStart + (click.time - seg.time) * speed;
      const beats = (songTime - 0.25) / 0.5;
      expect(Math.abs(beats - Math.round(beats))).toBeLessThan(1e-6);
    }
    // Loop has beats at 1.25, 1.75, 2.25, 2.75, 3.25 -> 5 clicks per repeat.
    expect(c.filter((x) => x.time < a[1].time).length).toBe(5);
  });

  it('count-in before start leads into the first beat', () => {
    const evs = collect({ startPos: 2.25, countInOnStart: true, countInBeats: 4 });
    const c = clicks(evs);
    const a = audio(evs)[0];
    expect(c.slice(0, 4).every((x) => x.countIn)).toBe(true);
    expect(c.slice(0, 4).map((x) => x.countInNumber)).toEqual([1, 2, 3, 4]);
    expect(c[0].time).toBe(0);
    expect(a.time).toBeCloseTo(2.0, 9); // 4 beats of 0.5 s
    expect(c[4].countIn).toBe(false);
    expect(c[4].time).toBeCloseTo(a.time, 9); // first metronome click = first song beat
    expect(c[4].beatInBar).toBe(0); // 2.25 s is beat 4 -> a downbeat
    expect(c[0].beatInBar).toBe(0); // so the count-in is a full bar 1-2-3-4
  });

  it('count-in with a pickup: song audio starts during the last count-in beat', () => {
    const evs = collect({ startPos: 2.0, countInOnStart: true, countInBeats: 2 });
    const c = clicks(evs);
    const a = audio(evs)[0];
    // first beat after 2.0 is 2.25 (0.25 s later). Clicks at 0, 0.5; beat at 1.0; audio at 0.75.
    expect(c[0].time).toBeCloseTo(0, 9);
    expect(c[1].time).toBeCloseTo(0.5, 9);
    expect(a.time).toBeCloseTo(0.75, 4);
    expect(c[2].time).toBeCloseTo(1.0, 4);
  });

  it('count-in before each loop repeat inserts a gap of whole beats', () => {
    const loop = { start: 1.25, end: 3.25 }; // exactly 4 beats
    const evs = collect({ loop, startPos: 1.25, countInOnRepeat: true, countInBeats: 4, speed: 0.5 }, 100);
    const a = audio(evs);
    // repeat duration 4 s (2 s at half speed), count-in 4 beats of 1 s.
    expect(a[0].time).toBe(0);
    expect(a[1].time).toBeCloseTo(4 + 4, 4);
    expect(a[2].time).toBeCloseTo(16, 4);
    const countIns = clicks(evs).filter((x) => x.countIn && x.time < a[1].time);
    expect(countIns.map((x) => x.time)).toEqual([4, 5, 6, 7].map((t) => expect.closeTo(t, 4)));
  });

  it('starting after the loop end jumps to the loop start; before it plays into the loop', () => {
    const loop = { start: 2, end: 4 };
    expect(audio(collect({ loop, startPos: 6 }, 10))[0].songStart).toBe(2);
    const a = audio(collect({ loop, startPos: 1 }, 10));
    expect(a[0].songStart).toBe(1);
    expect(a[0].songEnd).toBe(4);
    expect(a[1].songStart).toBe(2);
  });

  it('no BPM means no clicks and no count-in', () => {
    const evs = collect({ bpm: null, countInOnStart: true });
    expect(clicks(evs)).toEqual([]);
    expect(audio(evs)[0].time).toBe(0);
  });
});
