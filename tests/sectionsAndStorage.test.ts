import { describe, expect, it } from 'vitest';
import * as sec from '../src/sections/sections';
import { sanitizeSongData } from '../src/storage/sanitize';
import { buildExport, exportFileName, parseImport } from '../src/storage/exportImport';
import { DEFAULT_SONG_SETTINGS, SPEED_RANGE } from '../src/config';

describe('sections', () => {
  it('adds sections sorted by start, with default names', () => {
    let { sections } = sec.addSection([], 10, 20);
    ({ sections } = sec.addSection(sections, 5, 2, 'Intro')); // reversed range is fixed
    expect(sections.map((s) => [s.name, s.start, s.end])).toEqual([
      ['Intro', 2, 5],
      ['Section 1', 10, 20],
    ]);
    expect(sec.nextDefaultName(sections)).toBe('Section 3');
  });

  it('resizes without letting edges cross or leave the song', () => {
    const { sections, section } = sec.addSection([], 10, 20);
    expect(sec.resizeSection(sections, section.id, 'end', 5, 100)[0].end).toBeCloseTo(10 + sec.MIN_SECTION_SEC);
    expect(sec.resizeSection(sections, section.id, 'start', -3, 100)[0].start).toBe(0);
    expect(sec.resizeSection(sections, section.id, 'end', 500, 100)[0].end).toBe(100);
  });

  it('renames, deletes and navigates', () => {
    let { sections } = sec.addSection([], 0, 1, 'A');
    ({ sections } = sec.addSection(sections, 2, 3, 'B'));
    const [a, b] = sections;
    expect(sec.renameSection(sections, a.id, 'Verse')[0].name).toBe('Verse');
    expect(sec.deleteSection(sections, a.id)).toEqual([b]);
    expect(sec.adjacentSection(sections, a.id, 1)!.id).toBe(b.id);
    expect(sec.adjacentSection(sections, b.id, 1)!.id).toBe(b.id);
    expect(sec.adjacentSection(sections, null, -1)!.id).toBe(b.id);
  });
});

describe('sanitizeSongData', () => {
  it('fills defaults for missing/garbage input', () => {
    expect(sanitizeSongData(null).settings).toEqual(DEFAULT_SONG_SETTINGS);
    expect(sanitizeSongData({ settings: { bpm: 'fast', speed: 99 } }).settings.speed).toBe(SPEED_RANGE.max);
  });

  it('drops invalid sections and clamps to the song length', () => {
    const d = sanitizeSongData(
      {
        sections: [
          { id: 'a', name: 'ok', start: 1, end: 2 },
          { id: 'b', name: 'backwards', start: 5, end: 4 },
          { name: 'no id', start: 3, end: 999 },
          'junk',
        ],
        activeSectionId: 'b',
      },
      60,
    );
    expect(d.sections.map((s) => s.name)).toEqual(['ok', 'no id']);
    expect(d.sections[1].end).toBe(60);
    expect(d.activeSectionId).toBeNull(); // pointed at a dropped section
  });
});

describe('export / import', () => {
  const song = { id: 'sha256-abc', fileName: 'My Song.m4a', duration: 200, decoder: 'native' as const };

  it('round-trips', () => {
    const data = sanitizeSongData({
      settings: { bpm: 96, beatOffset: 0.31, countInOnRepeat: true },
      sections: [{ id: 'x', name: 'Chorus', start: 30, end: 45.5 }],
      activeSectionId: 'x',
      loopOn: true,
    });
    const parsed = parseImport(buildExport(song, data), song.duration);
    expect(parsed.data).toEqual(data);
    expect(parsed.song).toEqual({ id: song.id, fileName: song.fileName, duration: 200 });
    expect(exportFileName(song.fileName)).toBe('My Song.practice.json');
  });

  it('rejects files that are not practice files', () => {
    expect(() => parseImport('not json')).toThrow(/not JSON/);
    expect(() => parseImport('{"a":1}')).toThrow(/not a practice file/);
  });
});
