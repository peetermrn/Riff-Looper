# 🎸 Practice Player

A browser app for practising bass/guitar along with recorded songs and loops:
load a song, see its waveform, mark labelled sections, loop a section seamlessly,
slow it down without changing the pitch, and play along with a metronome and count-in.

- Static site: no backend, no accounts. **Audio files are opened locally and never uploaded.**
- Formats: `.m4a`, `.aac` (raw ADTS), `.mp3`, `.wav`, `.ogg`, `.flac`. If a browser can't
  decode a file itself, a fallback decoder (ffmpeg compiled to WebAssembly) is downloaded
  on demand. It's never loaded during normal use.
- Sections, BPM and the other per-song settings are saved in the browser automatically,
  and can be exported/imported as a small `.practice.json` file to share with friends.

---

## Run it locally

Requirements: **Node.js 20.19+** (or 22+). Check with `node -v`.

```bash
npm install
npm run dev          # opens a dev server, usually at http://localhost:5173
```

Production build (a static site in `dist/`, which any static web host can serve) and a local preview of it:

```bash
npm run build        # type-checks, then builds into dist/
npm run preview      # serves dist/ at http://localhost:4173
```

## Tests

```bash
npm test             # unit tests (Vitest): time-stretch, playback timing plan, sections, storage
npm run test:e2e     # browser tests (Playwright) in Chrome, Firefox and Chromium
```

Before the first browser-test run:

- `npx playwright install chromium firefox` installs the test browsers.
- Google Chrome must be installed for the `chrome` project. Without it, run
  `npx playwright test --project=firefox --project=chromium`.
- `ffmpeg` must be on the PATH. Test audio is generated automatically by
  `scripts/gen-test-audio.sh` into `test-audio/`, or run `npm run gen-test-audio` yourself.

The browser tests build the app, serve it, and then:

- decode and play every format;
- force the ffmpeg fallback for `.m4a`/`.aac`;
- create, rename, resize and delete sections, then reload, export and import;
- change speed and check that the pitch is kept;
- record the real audio output (song and clicks separately) during 15–20 loop repeats, to
  check that the metronome stays on the beat and loops have no gaps.

The full run takes about 10 minutes, because the timing tests play audio in real time.
`test-audio/groove100.m4a` is a small bass/drum loop at 100 BPM, handy for trying the app by ear.

---

## How to use

1. **Open a song**: use the button or drag a file onto the page.
2. **Navigate the waveform** (works like Premiere or Foxglove):
   - **Scroll wheel** zooms in/out around the mouse pointer.
   - **Shift+scroll**, a sideways trackpad swipe, or **middle-button drag** pans.
   - The **overview strip** above it is a zoom bar: drag the edges of its highlighted box to
     zoom, drag the box to pan, or click elsewhere on the strip to jump there.
3. **Sections**: drag across the waveform to select a range, then press **＋ Add section** (or `N`)
   and type a name. Rename it in the list. Resize it by dragging its edges on the waveform, or
   by typing the start/end times in the list. Clicking a section (in the list, or its label on
   the waveform) jumps to it.
4. **Loop**: press **Loop** (`L`) to loop the active section. With no section active, the
   current selection is looped.
5. **Speed**: use −/+, the presets or `↑`/`↓`. The pitch stays the same. The first time you pick a
   new speed, the slowed audio takes a moment to prepare (a progress bar shows). The old speed
   keeps playing until it's ready, then switches seamlessly.
6. **Metronome**: open the **Metronome & count-in** panel. It starts closed; while closed,
   its header shows a one-line summary of the settings.
   1. Type the song's **BPM** (or tap it with **Tap** / `T`).
   2. Line up the beat grid: pause exactly on a downbeat and press **Beat 1 = playhead** (`B`).
   3. Fine-tune with the ±1 ms / ±10 ms buttons until the grid lines on the waveform and the
      clicks sit on the beat.
   4. Turn on **Metronome** (`M`).
   5. Choose whether the click **follows the song speed** or stays at a **fixed BPM**.
7. **Count-in** (same panel): set the number of beats, then enable *Before play* (`C`) and/or *Before each loop*.

All keyboard shortcuts are listed in the app (**⌨ Shortcuts** or `?`).
They're defined in one table in `src/ui/shortcuts.ts`.

---

## Where things live

| Piece | Files |
|---|---|
| **Config / tunable values** (speed range, defaults, zoom, fade length…) | `src/config.ts` |
| **App controller**: every user action, wiring state ↔ audio ↔ storage | `src/app.ts` |
| **Audio engine**: playback, scheduling, loop, seamless speed switch | `src/audio/player.ts` |
| **Timing plan** (when each piece of audio and each click happens; pure, unit-tested) | `src/audio/playbackPlan.ts` |
| **Metronome / count-in** sounds | `src/audio/clickSounds.ts` (timing is in `playbackPlan.ts`) |
| **Time-stretch engine** (swappable) | `src/audio/timeStretch/` — interface `TimeStretcher.ts`, choice in `index.ts`, algorithm `wsola.ts`, runs in `wsola.worker.ts` |
| Speed → which buffer to play (render + cache) | `src/audio/speedController.ts` |
| **Decoding** (native first, lazy ffmpeg.wasm fallback) | `src/audio/decode/` |
| **Sections** (pure helpers: add/rename/resize/delete) | `src/sections/sections.ts` |
| **Storage**: autosave, song ID, export/import, validation | `src/storage/` |
| App state + tiny observable store; data types | `src/state/` |
| Waveform + overview (canvas, zoom, scroll, select, resize) | `src/waveform/` |
| UI panels, keyboard shortcuts | `src/ui/`, markup in `index.html`, styles in `src/styles.css` |
| Test hooks used by the browser tests (`window.__practice`) | `src/debug/` |
| Tests | `tests/` (unit), `e2e/` (browser), `scripts/gen-test-audio.sh` |

How playback timing works:

1. `playbackPlan.ts` computes a list of events: "play song time A–B at output time T", and
   "click at output time T".
2. Every loop repeat starts on a whole sample frame, so repeats butt up exactly.
3. Clicks are derived from the song's beat grid inside each repeat, not from a free-running
   timer, so they can't drift.
4. `player.ts` queues these events on the Web Audio clock about 1 s ahead (lookahead scheduling).
5. Slowed audio is pre-rendered for the whole song, so song time and output time map linearly
   (`output = song / speed`). That keeps the metronome maths exact.

### Extending later (not built yet, but planned for)

- **Higher-quality / wider-range time-stretch**: implement the `TimeStretcher` interface in
  `src/audio/timeStretch/` (e.g. with Rubber Band or Signalsmith Stretch compiled to WASM).
  Return it from `createTimeStretcher()` in `index.ts`, then widen `SPEED_RANGE` in `config.ts`.
  The interface comment explains the one hard rule: output sample *f* must match source
  sample *f × speed* (compensate any latency).
- **Pitch / key shift**: add a `pitch` parameter to `TimeStretcher.render()` (stretch, then
  resample). Timing code doesn't need to change as long as the rule above holds.
- **Auto speed-up per loop**: the plan already tags each loop repeat (`repeat` on audio events).
  Have the player report "repeat finished" and let `app.ts` call `setSpeed()`. Pre-render the
  next speed ahead of time, because a render takes a few seconds.
- **EQ**: insert `BiquadFilterNode`s between `songBus` and the destination in the `Player`
  constructor.

---

## Decisions & defaults

These are the choices I made where the brief didn't specify. All are easy to change; the
place to change each is noted.

**Tech**
- **Stack**: Vite + plain TypeScript, no UI framework. Fewer concepts to learn; every UI panel
  is one small file.
- **Time-stretch engine**: my own **WSOLA** implementation, plus "onset anchoring" so drum hits
  stay on time when slowed. It renders the whole song in a Web Worker whenever you pick a new
  speed. No dependency, no licence issues, and it keeps the timing exact.
  - Render time for a 5-minute song at 70%: about 2.5 s in Chrome and 3.5 s in Firefox on this
    machine.
  - The last 2 rendered speeds are kept in memory (`CACHE_SIZE` in `speedController.ts`).
- **Fallback decoder**: ffmpeg.wasm (`@ffmpeg/ffmpeg` 0.12, single-threaded core, about 32 MB).
  It's copied into `public/ffmpeg/` at build time and **served from your own site**, with no
  third-party CDN (to use a CDN instead, change `FFMPEG_CORE_BASE_URL` in `config.ts`). It
  downloads only when native decoding fails, and the browser caches it after that.

**Song identity and storage**
- **Song identity**: a song is recognised by a SHA-256 hash of the file's content, so a
  renamed file still finds its sections. A re-encoded copy of the same song (e.g. a friend's
  `.mp3` of your `.m4a`) is a different file. Importing a practice file into it asks for
  confirmation, then works.
- **What's saved per song**: BPM, beats per bar, beat-1 position, speed, metronome on/off,
  click mode, count-in settings, the sections, the active section and loop on/off.
- **What's global**: click volume and song volume. Storage is `localStorage`, with keys
  prefixed `practice-player:` (`STORAGE_PREFIX`).

**Speed**
- **Range**: 70%–100% (`SPEED_RANGE`).
- **Controls**: ±5% steps (`SPEED_STEP`) and presets at 70/75/80/85/90/100% (`SPEED_PRESETS`).
  The slider starts rendering when you let go of it.

**Metronome**
- **New-song defaults** (`DEFAULT_SONG_SETTINGS`):
  - BPM empty: the metronome and count-in stay disabled until you type one.
  - 4 beats per bar, beat 1 at 0.000 s.
  - Metronome off; the click follows the song speed.
  - Count-in set to 4 beats but turned off.
- **Click sounds** (`clickSounds.ts`):
  - Synthesised blips: a higher, louder click on beat 1 of each bar.
  - Count-in clicks have a distinct, higher pitch, so you can tell them apart.
  - The count-in plays even when the metronome is off.
- **"Fixed BPM" mode**:
  - At each play start and each loop repeat, the click grid starts on the song's first beat
    at or after that point.
  - From there it ticks at the typed BPM, ignoring the playback speed.
  - The count-in uses the same tempo as the click (slowed in "follows speed" mode, typed BPM
    in "fixed" mode).
- **Count-in alignment**: the count-in always leads into the first beat at or after the
  section start. If the section starts slightly before a beat (a pickup), that audio plays
  during the last count-in beat, as if a band counted you in.

**Looping and playback**
- **What gets looped**: the active section; with none active, the current selection.
- **Turning the loop on** jumps to the loop start if the playhead is outside the loop.
- **Seeking while looping**: jumping to before the loop end plays into the loop; jumping past
  it goes to the loop start.
- **Loop joins**: a 3 ms cross-fade at each loop join and at start/stop (`FADE_SEC`). This
  avoids a "click" from the waveform jump without shifting the timing.
- **Changing settings while playing** (BPM, beat 1, loop range, speed): playback continues
  seamlessly from the current position about 50 ms later. A count-in that is in progress is
  skipped.
- **End of the song** (when not looping): playback stops at the end; Play starts again from
  the beginning.

**Interface**
- **Waveform**:
  - Click = jump. Drag = select. Dragging near a section edge = resize.
  - Clicking a section's label = make it active.
  - Scroll wheel = zoom at the mouse (one notch ≈ 1.3×; `WHEEL_ZOOM_PX` in
    `WaveformView.ts`). Max zoom is 2000 px per second (`ZOOM`).
  - Shift+scroll, sideways trackpad swipe or middle-drag = pan.
  - Overview strip = Premiere-style zoom bar.
  - The view follows the playhead while playing, except for 2.5 s after you scroll it yourself.
- **Keys**: `←`/`→` seek 2 s (Shift: 10 s; `SEEK_STEP`), `↑`/`↓` change speed, `1`–`9` jump to
  sections. Deleting a section asks for confirmation; there is no delete key, to avoid
  accidents.
- **Metronome & count-in panel**: collapsed by default. Whether it's open is remembered per
  browser. Pressing `M`/`C` before a BPM is set opens it and puts the cursor in the BPM field.
  The song volume slider lives in the Speed panel, so it stays visible.
- **Theme**: dark or light, following the operating system. The main buttons are at least
  56 px tall (Play is 72 px).
- **Volumes**: linear sliders from 0 to 1.

## Known limitations

- **Time-stretch quality** is good for practice at 70–100%, but it's not studio grade.
  - Dense mixes can sound a little "phasey" when slowed.
  - Drum hits / attacks land within about 3–4 ms of their exact time when slowed (measured:
    a constant −3 ms at 70%, with no drift). Other material can be up to about 12 ms off.
  - Sustained low bass notes can dip briefly just before a strong drum hit.
  - For speeds below 70% or better quality, swap in a stronger engine (see *Extending later*).
- **Changing speed renders the whole song** (a few seconds for a typical song). The slowed
  copies take memory: about 115 MB per copy for a 5-minute stereo song at 48 kHz, and up to
  two are cached. Very long files (e.g. a 1-hour rehearsal recording) may be slow or
  memory-heavy.
- **Constant tempo only**: the beat grid is one BPM for the whole song. Songs that speed up or
  slow down (live recordings without a click) will drift away from the metronome. As a
  workaround, re-set "beat 1" (`B`) when you move to another part of the song.
- **Tested** with automated tests:
  - Google Chrome 155, Playwright's Firefox 159 and Playwright's Chromium (all on Ubuntu
    24.04): full suite.
  - Your installed (snap) Firefox 158: smoke test only (all six formats decode natively and
    play).
- **Not tested**: Safari, Windows, macOS, phones and tablets.
  - Safari decodes `.m4a`/`.aac` natively. Formats it can't decode (possibly `.ogg` on older
    versions) should go through the fallback.
  - On iPhones the hardware silent switch mutes web audio.
  - The layout works on narrow screens but is designed for a laptop or desktop.
- **The fallback decoder**:
  - It's a ~32 MB download the first time it's needed.
  - It decodes the whole file in memory.
  - It always produces stereo (mono files are duplicated; surround is downmixed).
- **Browser storage**: saved sections live in this browser's `localStorage`. Clearing site
  data deletes them, and they don't sync between browsers or computers. Use **Export** as a
  backup and to share.
- **Background tabs**: Chrome and Firefox don't throttle tabs that are playing audio. If a
  browser did, the 1 s of pre-scheduled audio covers short hiccups, but a long stall could
  glitch.
- **Hosting**: the build includes the 32 MB `ffmpeg-core.wasm` as a normal static file. If
  a static host refuses a file that large, point `FFMPEG_CORE_BASE_URL` (in `config.ts`) at
  a CDN copy instead.
- **Keyboard layouts**: some shortcut keys (`[`, `]`, `?`) are in different places on
  non-US keyboards. The letter shortcuts work on any layout.

## License

This project is released into the public domain under [The Unlicense](LICENSE): anyone
may use, copy, modify, publish, sell or distribute it, for any purpose, without asking
and without crediting anyone.

Third-party packages keep their own licences. Most notably, the fallback decoder
`@ffmpeg/core` (ffmpeg compiled to WebAssembly) is GPL-2.0-or-later. It isn't part of this
repository: it's installed by npm and copied into `dist/ffmpeg/` at build time. If you
publish a build, that one file is GPL software, whose source is available from the
[ffmpeg.wasm project](https://github.com/ffmpegwasm/ffmpeg.wasm).
