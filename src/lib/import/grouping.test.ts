import { describe, expect, it } from 'vitest';
import type { AudioMeta } from '../metadata';
import { parseCue } from '../metadata';
import { buildDrafts, suggestMode, type Analysis, type AudioFile } from './grouping';

const audio = (path: string, duration: number, meta: Partial<AudioMeta> = {}): AudioFile => {
  const file = new File([new Uint8Array(10)], path.split('/').pop()!);
  return { source: { file, path }, blob: file, duration, meta: { chapters: [], ...meta } };
};
const image = (path: string, size = 10) => ({ file: new File([new Uint8Array(size)], path.split('/').pop()!), path });
const analysis = (files: AudioFile[], extra: Partial<Analysis> = {}): Analysis => ({
  audio: files,
  images: [],
  cues: [],
  skipped: [],
  ...extra,
});

describe('suggestMode', () => {
  it('treats CD folders as one book', () => {
    const a = analysis([audio('Book/CD1/01.mp3', 10), audio('Book/CD2/01.mp3', 10)]);
    expect(suggestMode(a)).toBe('single');
  });

  it('treats separate folders as separate books', () => {
    const a = analysis([audio('Dune/01.mp3', 10), audio('Solaris/01.mp3', 10)]);
    expect(suggestMode(a)).toBe('folders');
  });

  it('treats several m4b files as separate books', () => {
    expect(suggestMode(analysis([audio('a.m4b', 10), audio('b.m4b', 10)]))).toBe('files');
  });

  it('treats mp3 files in one folder as one book', () => {
    expect(suggestMode(analysis([audio('B/01.mp3', 10), audio('B/02.mp3', 10)]))).toBe('single');
  });
});

describe('buildDrafts', () => {
  it('makes one chapter per file when files have no chapters', () => {
    const a = analysis([
      audio('Мастер и Маргарита/01.mp3', 100, { title: 'Глава 1', album: 'Мастер и Маргарита', artist: 'Булгаков' }),
      audio('Мастер и Маргарита/02.mp3', 50, { title: 'Глава 2', album: 'Мастер и Маргарита', artist: 'Булгаков' }),
    ]);
    const [draft] = buildDrafts(a, 'single');
    expect(draft.title).toBe('Мастер и Маргарита');
    expect(draft.author).toBe('Булгаков');
    expect(draft.duration).toBe(150);
    expect(draft.chapters).toEqual([
      { title: 'Глава 1', start: 0 },
      { title: 'Глава 2', start: 100 },
    ]);
  });

  it('uses file names when tag titles repeat', () => {
    const a = analysis([audio('Book/Part 1.mp3', 10, { title: 'Book' }), audio('Book/Part 2.mp3', 10, { title: 'Book' })]);
    const [draft] = buildDrafts(a, 'single');
    expect(draft.title).toBe('Book');
    expect(draft.chapters.map((c) => c.title)).toEqual(['Part 1', 'Part 2']);
  });

  it('places embedded chapters on the book timeline', () => {
    const a = analysis([
      audio('x/1.m4b', 100, { chapters: [{ title: 'Пролог', start: 0 }, { title: 'Первая', start: 40 }] }),
      audio('x/2.m4b', 100, { chapters: [{ title: 'Вторая', start: 20 }, { title: '', start: 60 }] }),
    ]);
    const [draft] = buildDrafts(a, 'single');
    expect(draft.chapters).toEqual([
      { title: 'Пролог', start: 0 },
      { title: 'Первая', start: 40 },
      { title: '2', start: 100 }, // the part before the first embedded chapter
      { title: 'Вторая', start: 120 },
      { title: 'Глава 5', start: 160 },
    ]);
  });

  it('splits by file or folder', () => {
    const a = analysis([audio('A/1.mp3', 1), audio('A/2.mp3', 1), audio('B/1.mp3', 1)]);
    expect(buildDrafts(a, 'files')).toHaveLength(3);
    expect(buildDrafts(a, 'folders').map((d) => [d.title, d.files.length])).toEqual([
      ['A', 2],
      ['B', 1],
    ]);
  });

  it('reads the table of contents from a cue sheet', () => {
    const sheet = parseCue(
      'PERFORMER "Автор"\nTITLE "Книга"\nFILE "book.wav" WAVE\n TRACK 01 AUDIO\n  TITLE "Начало"\n  INDEX 01 00:00:00\n TRACK 02 AUDIO\n  TITLE "Конец"\n  INDEX 01 01:30:00\n',
    );
    const a = analysis([audio('book.mp3', 200)], { cues: [{ path: 'book.cue', sheet }] });
    const [draft] = buildDrafts(a, 'single');
    expect(draft.title).toBe('Книга');
    expect(draft.author).toBe('Автор');
    expect(draft.chapters).toEqual([
      { title: 'Начало', start: 0 },
      { title: 'Конец', start: 90 },
    ]);
  });

  it('prefers a cover image from the book folder', () => {
    const a = analysis([audio('Book/1.mp3', 1)], {
      images: [image('Other/cover.jpg', 100), image('Book/scan.png', 50), image('Book/cover.jpg', 20)],
    });
    expect(buildDrafts(a, 'single')[0].cover).toBe(a.images[2].file);
  });
});
