/**
 * Pure helpers for working with sections (labelled time ranges).
 * They return new arrays and never mutate their input.
 */
import type { Section } from '../state/types';
import { newId } from '../storage/sanitize';

/** Shortest allowed section, seconds. */
export const MIN_SECTION_SEC = 0.05;

export function sortSections(sections: Section[]): Section[] {
  return [...sections].sort((a, b) => a.start - b.start || a.end - b.end);
}

export function addSection(
  sections: Section[],
  start: number,
  end: number,
  name?: string,
): { sections: Section[]; section: Section } {
  const [s, e] = start <= end ? [start, end] : [end, start];
  const section: Section = {
    id: newId(),
    name: name?.trim() || nextDefaultName(sections),
    start: s,
    end: Math.max(e, s + MIN_SECTION_SEC),
  };
  return { sections: sortSections([...sections, section]), section };
}

export function nextDefaultName(sections: Section[]): string {
  let n = sections.length + 1;
  const names = new Set(sections.map((s) => s.name));
  while (names.has(`Section ${n}`)) n++;
  return `Section ${n}`;
}

export function renameSection(sections: Section[], id: string, name: string): Section[] {
  return sections.map((s) => (s.id === id ? { ...s, name: name.slice(0, 100) } : s));
}

/** Move one edge of a section. Edges can't cross; the result is clamped to the song. */
export function resizeSection(
  sections: Section[],
  id: string,
  edge: 'start' | 'end',
  time: number,
  songDuration: number,
): Section[] {
  return sortSections(
    sections.map((s) => {
      if (s.id !== id) return s;
      const t = Math.max(0, Math.min(songDuration, time));
      if (edge === 'start') return { ...s, start: Math.min(t, s.end - MIN_SECTION_SEC) };
      return { ...s, end: Math.max(t, s.start + MIN_SECTION_SEC) };
    }),
  );
}

export function deleteSection(sections: Section[], id: string): Section[] {
  return sections.filter((s) => s.id !== id);
}

/** The section after/before the one with `id` (by start time), or the first one. */
export function adjacentSection(sections: Section[], id: string | null, dir: 1 | -1): Section | null {
  const sorted = sortSections(sections);
  if (sorted.length === 0) return null;
  const i = sorted.findIndex((s) => s.id === id);
  if (i < 0) return dir === 1 ? sorted[0] : sorted[sorted.length - 1];
  return sorted[Math.max(0, Math.min(sorted.length - 1, i + dir))];
}

/** Distinct colours for sections, cycled by index. */
const PALETTE = ['#4f8cff', '#f59e0b', '#10b981', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16'];
export function sectionColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}
