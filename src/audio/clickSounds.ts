/**
 * Synthesised click sounds. Each starts at full level on its very first sample
 * (so the click is heard exactly when scheduled) and decays quickly.
 * Tweak frequencies/levels here to change how the metronome sounds.
 */
export interface ClickSounds {
  beat: AudioBuffer; // ordinary beat
  accent: AudioBuffer; // first beat of the bar
  countIn: AudioBuffer; // count-in beat (distinct, so you know it's the count-in)
  countInAccent: AudioBuffer;
}

export function createClickSounds(ctx: BaseAudioContext): ClickSounds {
  return {
    beat: blip(ctx, 1000, 0.55),
    accent: blip(ctx, 1600, 0.85),
    countIn: blip(ctx, 2200, 0.55, 0.012),
    countInAccent: blip(ctx, 2800, 0.85, 0.012),
  };
}

function blip(ctx: BaseAudioContext, freq: number, level: number, decaySec = 0.008): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.round(sr * decaySec * 6);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // cosine start = full level at sample 0 (a sharp, well-defined attack)
    d[i] = level * Math.cos(2 * Math.PI * freq * t) * Math.exp(-t / decaySec);
  }
  return buf;
}
