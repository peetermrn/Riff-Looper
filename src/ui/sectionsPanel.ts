/**
 * The list of sections: click to jump (and make active), rename inline, edit
 * start/end, loop, delete. Also the "Add section" button and selection info.
 */
import type { App } from '../app';
import { sectionColor } from '../sections/sections';
import type { Section } from '../state/types';
import { $, formatTime, parseTime } from './dom';

export function mountSectionsPanel(app: App): { focusName(id: string): void } {
  const list = $<HTMLOListElement>('sections-list');
  const addBtn = $<HTMLButtonElement>('add-section-btn');
  addBtn.addEventListener('click', () => {
    const id = app.addSectionFromSelection();
    if (id) focusName(id);
  });

  function focusName(id: string): void {
    // Wait for the list to re-render, then focus + select the name for typing.
    requestAnimationFrame(() => {
      const input = list.querySelector<HTMLInputElement>(`li[data-id="${id}"] .name`);
      input?.focus();
      input?.select();
    });
  }

  let lastSections: Section[] | null = null;
  let lastActive: string | null | undefined;
  let lastLoop: boolean | undefined;

  app.store.subscribe((s) => {
    const sel = s.selection;
    addBtn.disabled = !sel;
    $('selection-info').textContent = sel
      ? `Selected ${formatTime(sel.start, 2)} – ${formatTime(sel.end, 2)} (${(sel.end - sel.start).toFixed(2)} s)`
      : '';
    $('sections-empty').hidden = s.data.sections.length > 0;

    if (s.data.sections === lastSections && s.data.activeSectionId === lastActive && s.data.loopOn === lastLoop) return;
    lastSections = s.data.sections;
    lastActive = s.data.activeSectionId;
    lastLoop = s.data.loopOn;
    render(s.data.sections, s.data.activeSectionId, s.data.loopOn);
  });

  function render(sections: Section[], activeId: string | null, loopOn: boolean): void {
    const focused = document.activeElement as HTMLElement | null;
    const focusedId = focused?.closest('li')?.dataset.id;
    const focusedClass = focused?.className;

    // Re-use existing rows where possible so typing in a field isn't interrupted.
    const existing = new Map<string, HTMLLIElement>();
    for (const li of Array.from(list.children) as HTMLLIElement[]) existing.set(li.dataset.id!, li);
    list.innerHTML = '';
    sections.forEach((section, i) => {
      const li = existing.get(section.id) ?? createRow(section.id);
      updateRow(li, section, i, section.id === activeId, loopOn);
      list.appendChild(li);
    });
    if (focusedId && focusedClass) {
      const el = list.querySelector<HTMLElement>(`li[data-id="${focusedId}"] .${focusedClass.split(' ')[0]}`);
      if (el && document.activeElement !== el) el.focus();
    }
  }

  function createRow(id: string): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'section-item';
    li.dataset.id = id;
    li.innerHTML = `
      <span class="swatch"></span>
      <input class="name" aria-label="Section name" maxlength="100" />
      <span class="times">
        <input class="start time-input" aria-label="Start time" size="7" /> –
        <input class="end time-input" aria-label="End time" size="7" />
      </span>
      <button class="btn loop" title="Loop this section">🔁</button>
      <button class="btn delete" title="Delete section">✕</button>`;
    const name = li.querySelector<HTMLInputElement>('.name')!;
    const start = li.querySelector<HTMLInputElement>('.start')!;
    const end = li.querySelector<HTMLInputElement>('.end')!;

    li.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, button')) return;
      app.activateSection(id);
    });
    name.addEventListener('focus', () => {
      if (app.state.data.activeSectionId !== id) app.activateSection(id, false);
    });
    name.addEventListener('input', () => app.renameSection(id, name.value));
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') name.blur();
    });
    name.addEventListener('blur', () => {
      if (!name.value.trim()) app.renameSection(id, 'Section');
    });
    const applyTimes = () => {
      const s = parseTime(start.value);
      const en = parseTime(end.value);
      const cur = app.state.data.sections.find((x) => x.id === id);
      if (s === null || en === null || !cur) {
        if (cur) {
          start.value = formatTime(cur.start, 2);
          end.value = formatTime(cur.end, 2);
        }
        return;
      }
      app.setSectionTimes(id, s, en);
    };
    for (const inp of [start, end]) {
      inp.addEventListener('change', applyTimes);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') inp.blur();
      });
    }
    li.querySelector('.loop')!.addEventListener('click', () => {
      const s = app.state;
      if (s.data.activeSectionId === id && s.data.loopOn) {
        app.toggleLoop();
      } else {
        app.activateSection(id);
        if (!app.state.data.loopOn) app.toggleLoop();
      }
    });
    li.querySelector('.delete')!.addEventListener('click', () => {
      const sec = app.state.data.sections.find((x) => x.id === id);
      if (sec && confirm(`Delete section “${sec.name}”?`)) app.deleteSection(id);
    });
    return li;
  }

  function updateRow(li: HTMLLIElement, s: Section, index: number, active: boolean, loopOn: boolean): void {
    li.classList.toggle('active', active);
    (li.querySelector('.swatch') as HTMLElement).style.background = sectionColor(index);
    const name = li.querySelector<HTMLInputElement>('.name')!;
    if (document.activeElement !== name && name.value !== s.name) name.value = s.name;
    const start = li.querySelector<HTMLInputElement>('.start')!;
    const end = li.querySelector<HTMLInputElement>('.end')!;
    if (document.activeElement !== start) start.value = formatTime(s.start, 2);
    if (document.activeElement !== end) end.value = formatTime(s.end, 2);
    const loopBtn = li.querySelector<HTMLButtonElement>('.loop')!;
    loopBtn.classList.toggle('on', active && loopOn);
    loopBtn.title = active && loopOn ? 'Stop looping' : 'Loop this section';
  }

  return { focusName };
}
