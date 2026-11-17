/** Play/pause, seek buttons, loop toggle, time display, beat dots and count-in display. */
import { loopRegion, type App } from '../app';
import { $, formatTime, setToggle } from './dom';

export function mountTransport(app: App): { tick(): void } {
  const playBtn = $<HTMLButtonElement>('play-btn');
  playBtn.addEventListener('click', () => app.togglePlay());
  $('start-btn').addEventListener('click', () => app.goToStart());
  $('back-btn').addEventListener('click', () => app.seekSmall(-1));
  $('fwd-btn').addEventListener('click', () => app.seekSmall(1));
  $('loop-btn').addEventListener('click', () => app.toggleLoop());

  const dots = $('beat-dots');
  const countIn = $('countin-display');
  let dotCount = -1;

  app.store.subscribe((s) => {
    setToggle($('loop-btn'), s.data.loopOn);
    $('time-dur').textContent = formatTime(s.song?.duration ?? 0);
    const region = loopRegion(s);
    const active = s.data.sections.find((x) => x.id === s.data.activeSectionId);
    $('loop-info').textContent = region
      ? `Looping ${active ? '“' + active.name + '”' : 'selection'} (${formatTime(region.start)}–${formatTime(region.end)})`
      : s.data.loopOn
        ? 'Loop on — pick a section'
        : '';
    const bpb = s.data.settings.bpm ? s.data.settings.beatsPerBar : 0;
    if (bpb !== dotCount) {
      dotCount = bpb;
      dots.innerHTML = '';
      for (let i = 0; i < bpb; i++) {
        const d = document.createElement('span');
        if (i === 0) d.className = 'down';
        dots.appendChild(d);
      }
    }
  });

  const timePos = $('time-pos');
  /** Only touch the DOM when the text actually changes (this runs every frame). */
  const setText = (el: HTMLElement, text: string) => {
    if (el.textContent !== text) el.textContent = text;
  };

  /** Called every animation frame. */
  function tick(): void {
    const p = app.player;
    const playing = !!p?.isPlaying;
    setText(playBtn, playing ? '❚❚' : '▶');
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    setText(timePos, formatTime(p?.position ?? 0));

    const beat = p?.lastBeat ?? null;
    // Light the dot for ~0.15 s after each click.
    const fresh = beat && p && p.ctx.currentTime - beat.time < 0.15 + (p.ctx.outputLatency || 0);
    Array.from(dots.children).forEach((d, i) => {
      d.classList.toggle('lit', !!beat && beat.beatInBar === i && !!fresh);
      d.classList.toggle('countin', !!beat?.countIn);
    });
    setText(countIn, p?.inCountIn && beat ? String(beat.countInNumber) : '');
  }

  return { tick };
}
