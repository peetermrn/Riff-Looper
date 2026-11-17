/**
 * Entry point: creates the app and mounts the UI pieces.
 *
 * Where things live:
 *   src/app.ts                 actions + wiring between state, audio and storage
 *   src/audio/                 audio engine (player, playback plan, clicks, decoding, time-stretch)
 *   src/sections/              section helpers
 *   src/storage/               saving in the browser, export/import
 *   src/waveform/              waveform + overview canvases
 *   src/ui/                    panels, buttons and keyboard shortcuts
 */
import './styles.css';
import { App } from './app';
import { installTestHooks } from './debug/testHooks';
import { $, blurButtonsAfterClick } from './ui/dom';
import { mountFilePanel } from './ui/filePanel';
import { mountMetronomePanel } from './ui/metronomePanel';
import { mountSectionsPanel } from './ui/sectionsPanel';
import { mountShortcuts } from './ui/shortcuts';
import { mountSpeedPanel } from './ui/speedPanel';
import { mountTransport } from './ui/transportBar';
import { mountWaveformPanel } from './ui/waveformPanel';

const app = new App();

mountFilePanel(app);
const sections = mountSectionsPanel(app);
const waveform = mountWaveformPanel(app, sections.focusName);
const transport = mountTransport(app);
mountSpeedPanel(app);
mountMetronomePanel(app);

const helpDialog = $<HTMLDialogElement>('shortcuts-dialog');
const showHelp = () => helpDialog.showModal();
$('help-btn').addEventListener('click', showHelp);

mountShortcuts({
  app,
  zoomIn: () => waveform.view.zoomIn(),
  zoomOut: () => waveform.view.zoomOut(),
  zoomFit: () => waveform.view.zoomFit(),
  addSection: () => {
    const id = app.addSectionFromSelection();
    if (id) sections.focusName(id);
  },
  showHelp,
  openFile: () => $('file-input').click(),
});
blurButtonsAfterClick();

// Push the initial state to all subscribers.
app.store.update((s) => ({ ...s }));

// Animation loop for the playhead, time display and beat indicator.
function frame() {
  waveform.tick();
  transport.tick();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('pagehide', () => app.flushSave());
window.addEventListener('beforeunload', () => app.flushSave());

installTestHooks(app, waveform.view);
