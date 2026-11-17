/** Open (button + drag-and-drop), export and import. */
import type { App } from '../app';
import { $ } from './dom';

const AUDIO_EXT = /\.(m4a|mp4|aac|mp3|wav|wave|ogg|oga|opus|flac|webm|aif|aiff)$/i;

export function mountFilePanel(app: App): void {
  const fileInput = $<HTMLInputElement>('file-input');
  const importInput = $<HTMLInputElement>('import-input');
  const openFilePicker = () => fileInput.click();

  $('open-btn').addEventListener('click', openFilePicker);
  $('empty-open-btn').addEventListener('click', openFilePicker);
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void app.openFile(f);
    fileInput.value = ''; // allow re-opening the same file
  });

  $('export-btn').addEventListener('click', () => app.exportPractice());
  $('import-btn').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => {
    const f = importInput.files?.[0];
    if (f) void app.importPractice(f);
    importInput.value = '';
  });

  // Drag and drop anywhere on the page. A .json file is treated as an import.
  const overlay = $('drop-overlay');
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    depth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.hidden = true;
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    const f = e.dataTransfer?.files[0];
    if (!f) return;
    if (/\.json$/i.test(f.name)) void app.importPractice(f);
    else if (AUDIO_EXT.test(f.name) || f.type.startsWith('audio/') || f.type.startsWith('video/')) void app.openFile(f);
    else app.setStatus(`“${f.name}” doesn’t look like an audio file.`, 'error');
  });

  app.store.subscribe((s) => {
    $('file-name').textContent = s.song ? s.song.fileName : '';
    $<HTMLButtonElement>('export-btn').disabled = !s.song;
    $<HTMLButtonElement>('import-btn').disabled = !s.song;
    $('empty-state').hidden = !!s.song;
    $('player-ui').hidden = !s.song;
    const status = $('status');
    status.textContent = s.status?.message ?? '';
    status.classList.toggle('error', s.status?.kind === 'error');
  });
}
