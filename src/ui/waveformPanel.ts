/** Connects the waveform + overview canvases to the app. */
import { loopRegion, type App } from '../app';
import { sortSections } from '../sections/sections';
import { Overview } from '../waveform/Overview';
import { WaveformView } from '../waveform/WaveformView';
import { $ } from './dom';

export function mountWaveformPanel(app: App, focusSectionName: (id: string) => void) {
  const overview = new Overview($('overview'), {
    onSeek: (t) => app.seek(t),
    onScroll: (t) => view.centerOn(t),
  });

  const view = new WaveformView($('waveform'), {
    onSeek: (t) => app.seek(t),
    onSelect: (sel) => app.setSelection(sel),
    onResizeSection: (id, edge, time) => app.resizeSection(id, edge, time),
    onActivateSection: (id) => {
      app.activateSection(id);
      focusSectionName(id);
    },
    onViewChange: () => refreshOverview(),
  });

  $('zoom-in-btn').addEventListener('click', () => view.zoomIn());
  $('zoom-out-btn').addEventListener('click', () => view.zoomOut());
  $('zoom-fit-btn').addEventListener('click', () => view.zoomFit());

  app.onAudioLoaded((buffer) => {
    view.setAudio(buffer);
    overview.setAudio(buffer);
  });

  app.store.subscribe((s) => {
    const st = s.data.settings;
    view.setData({
      sections: sortSections(s.data.sections),
      activeSectionId: s.data.activeSectionId,
      selection: s.selection,
      loopRegion: loopRegion(s),
      bpm: st.bpm,
      beatOffset: st.beatOffset,
      beatsPerBar: st.beatsPerBar,
    });
    refreshOverview();
  });

  function refreshOverview() {
    overview.update(sortSections(app.state.data.sections), view.view, app.player?.position ?? 0);
  }

  /** Called every animation frame. */
  function tick() {
    const p = app.player;
    if (!p) return;
    view.setPlayhead(p.position, p.isPlaying);
    refreshOverview();
  }

  return { view, tick };
}
