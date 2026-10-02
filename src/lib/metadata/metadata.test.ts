import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCue, readAudioMeta } from './index';
import { decodeLegacy, decodeTextFile } from './text';

const fixture = (name: string) =>
  new Blob([readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url))]);

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const utf8 = (s: string) => new TextEncoder().encode(s);
const be32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const be64 = (n: number) => concat([be32(Math.floor(n / 2 ** 32)), be32(n % 2 ** 32)]);
const box = (type: string, ...parts: Uint8Array[]) => {
  const body = concat(parts);
  return concat([be32(body.length + 8), ascii(type), body]);
};
/** Cyrillic text in Windows-1251. */
const cp1251 = (s: string) =>
  Uint8Array.from(s, (c) => {
    const code = c.charCodeAt(0);
    if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
    if (c === 'Ё') return 0xa8;
    if (c === 'ё') return 0xb8;
    return code;
  });
const id3v23 = (frames: [string, Uint8Array][]) => {
  const body = concat(frames.map(([id, data]) => concat([ascii(id), be32(data.length), new Uint8Array(2), data])));
  const size = body.length;
  const syncsafe = Uint8Array.of((size >> 21) & 127, (size >> 14) & 127, (size >> 7) & 127, size & 127);
  return concat([ascii('ID3'), Uint8Array.of(3, 0, 0), syncsafe, body]);
};

const expectedChapters = [
  { title: 'Глава первая', start: 0 },
  { title: 'Глава вторая', start: 1.5 },
  { title: 'Эпилог', start: 3 },
];

describe('readAudioMeta', () => {
  it.each(['book.m4b', 'qt-only.m4b', 'book.mp3', 'book-v24.mp3'])(
    'reads tags and chapters from %s',
    async (name) => {
      const meta = await readAudioMeta(fixture(name));
      expect(meta.title).toBe('Тестовая книга');
      expect(meta.artist).toBe('Автор Тестов');
      expect(meta.album).toBe('Тестовая книга');
      expect(meta.chapters.map((c) => c.title)).toEqual(expectedChapters.map((c) => c.title));
      meta.chapters.forEach((c, i) => expect(c.start).toBeCloseTo(expectedChapters[i].start, 2));
    },
  );

  it('reads the duration and cover art of an m4b', async () => {
    const meta = await readAudioMeta(fixture('book.m4b'));
    expect(meta.duration).toBeCloseTo(4, 1);
    expect(meta.cover?.type).toBe('image/jpeg');
    const cover = new Uint8Array(await meta.cover!.arrayBuffer());
    expect([cover[0], cover[1]]).toEqual([0xff, 0xd8]); // JPEG SOI marker
  });

  it('falls back to Nero chpl chapters', async () => {
    const entry = (start: number, title: string) => {
      const t = utf8(title);
      return concat([be64(start), Uint8Array.of(t.length), t]);
    };
    const chpl = box('chpl', Uint8Array.of(1, 0, 0, 0, 0), be32(2), entry(0, 'Пролог'), entry(615_000_000, 'Часть 1'));
    const file = new Blob([concat([box('ftyp', ascii('M4A '), be32(0)), box('moov', box('udta', chpl))])]);
    const meta = await readAudioMeta(file);
    expect(meta.chapters).toEqual([
      { title: 'Пролог', start: 0 },
      { title: 'Часть 1', start: 61.5 },
    ]);
  });

  it('finds moov after mdat', async () => {
    const chpl = box('chpl', Uint8Array.of(0, 0, 0, 0), Uint8Array.of(1), be64(0), Uint8Array.of(1), ascii('A'));
    const file = new Blob([
      concat([box('ftyp', ascii('isom'), be32(0)), box('mdat', new Uint8Array(5000)), box('moov', box('udta', chpl))]),
    ]);
    expect((await readAudioMeta(file)).chapters).toEqual([{ title: 'A', start: 0 }]);
  });

  it('decodes cp1251 text in ID3 frames that claim Latin-1', async () => {
    const tag = id3v23([
      ['TIT2', concat([Uint8Array.of(0), cp1251('Мастер и Маргарита')])],
      ['TPE1', concat([Uint8Array.of(0), cp1251('Михаил Булгаков'), Uint8Array.of(0)])],
      ['TALB', concat([Uint8Array.of(1, 0xff, 0xfe), new Uint8Array(new Uint16Array(Array.from('Ёлка', (c) => c.charCodeAt(0))).buffer)])],
    ]);
    const meta = await readAudioMeta(new Blob([tag, new Uint8Array(100)]));
    expect(meta.title).toBe('Мастер и Маргарита');
    expect(meta.artist).toBe('Михаил Булгаков');
    expect(meta.album).toBe('Ёлка');
  });

  it('returns empty metadata for unknown data', async () => {
    expect(await readAudioMeta(new Blob([new Uint8Array(300)]))).toEqual({ chapters: [] });
  });
});

describe('text decoding', () => {
  it('tells cp1251 from Latin-1 and UTF-8', () => {
    expect(decodeLegacy(cp1251('Глава 1. Ёжик'))).toBe('Глава 1. Ёжик');
    expect(decodeLegacy(Uint8Array.of(0x43, 0x61, 0x66, 0xe9))).toBe('Café');
    expect(decodeLegacy(utf8('Война и мир'))).toBe('Война и мир');
    expect(decodeTextFile(concat([Uint8Array.of(0xef, 0xbb, 0xbf), utf8('Привет')]))).toBe('Привет');
  });
});

describe('parseCue', () => {
  it('parses titles, performers and track starts', () => {
    const sheet = parseCue(
      [
        'REM GENRE Audiobook',
        'PERFORMER "Лев Толстой"',
        'TITLE "Война и мир"',
        'FILE "Том 1.mp3" MP3',
        '  TRACK 01 AUDIO',
        '    TITLE "Часть первая"',
        '    INDEX 01 00:00:00',
        '  TRACK 02 AUDIO',
        '    TITLE "Часть вторая"',
        '    INDEX 00 61:58:00',
        '    INDEX 01 62:00:37',
        'FILE track2.mp3 MP3',
        '  TRACK 03 AUDIO',
        '    INDEX 01 00:00:00',
      ].join('\r\n'),
    );
    expect(sheet.title).toBe('Война и мир');
    expect(sheet.performer).toBe('Лев Толстой');
    expect(sheet.files.map((f) => f.name)).toEqual(['Том 1.mp3', 'track2.mp3']);
    expect(sheet.files[0].tracks).toEqual([
      { title: 'Часть первая', performer: undefined, start: 0 },
      { title: 'Часть вторая', performer: undefined, start: 3720 + 37 / 75 },
    ]);
    expect(sheet.files[1].tracks[0].title).toBe('');
  });
});
