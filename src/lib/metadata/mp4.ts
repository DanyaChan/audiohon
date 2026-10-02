import { ascii, readRange, u16, u32, u64, type Bytes } from './bytes';
import { decodeUtf16, decodeUtf8 } from './text';
import type { AudioMeta, RawChapter } from './types';

/** Refuse to load absurdly large `moov` boxes into memory. */
const MAX_MOOV = 64 * 1024 * 1024;

interface Box {
  type: string;
  /** Offset of the box contents (after the header). */
  body: number;
  end: number;
}

function* boxes(b: Bytes, start: number, end: number): Generator<Box> {
  let p = start;
  while (p + 8 <= end) {
    let size = u32(b, p);
    let header = 8;
    if (size === 1) {
      if (p + 16 > end) return;
      size = u64(b, p + 8);
      header = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < header || p + size > end) return;
    yield { type: ascii(b, p + 4, 4), body: p + header, end: p + size };
    p += size;
  }
}

function child(b: Bytes, parent: Box | undefined, ...path: string[]): Box | undefined {
  let box = parent;
  for (const type of path) {
    if (!box) return undefined;
    let found: Box | undefined;
    for (const c of boxes(b, box.body, box.end)) {
      if (c.type === type) {
        found = c;
        break;
      }
    }
    box = found;
  }
  return box;
}

const children = (b: Bytes, parent: Box, type: string) =>
  [...boxes(b, parent.body, parent.end)].filter((c) => c.type === type);

/** Reads the top-level `moov` box (it may sit before or after the media data). */
async function readMoov(file: Blob): Promise<Bytes | null> {
  let p = 0;
  while (p + 8 <= file.size) {
    const h = await readRange(file, p, 16);
    let size = u32(h, 0);
    const type = ascii(h, 4, 4);
    if (size === 1) size = u64(h, 8);
    else if (size === 0) size = file.size - p;
    if (size < 8) return null;
    if (type === 'moov') return size > MAX_MOOV ? null : readRange(file, p, size);
    p += size;
  }
  return null;
}

export async function readMp4(file: Blob): Promise<AudioMeta> {
  const meta: AudioMeta = { chapters: [] };
  const b = await readMoov(file);
  if (!b) return meta;
  const moov = boxes(b, 0, b.length).next().value;
  if (!moov) return meta;

  const mvhd = child(b, moov, 'mvhd');
  if (mvhd) {
    const v1 = b[mvhd.body] === 1;
    const timescale = u32(b, mvhd.body + (v1 ? 20 : 12));
    const duration = v1 ? u64(b, mvhd.body + 24) : u32(b, mvhd.body + 16);
    if (timescale) meta.duration = duration / timescale;
  }

  readTags(b, moov, meta);
  meta.chapters = await readChapterTrack(file, b, moov);
  if (!meta.chapters.length) meta.chapters = readNeroChapters(b, moov);
  return meta;
}

function readTags(b: Bytes, moov: Box, meta: AudioMeta) {
  const metaBox = child(b, moov, 'udta', 'meta') ?? child(b, moov, 'meta');
  if (!metaBox) return;
  // In ISO files `meta` is a full box (4 bytes of version/flags), in QuickTime ones it is not.
  const start = ascii(b, metaBox.body + 4, 4) === 'hdlr' ? metaBox.body : metaBox.body + 4;
  const ilst = [...boxes(b, start, metaBox.end)].find((c) => c.type === 'ilst');
  if (!ilst) return;

  for (const item of boxes(b, ilst.body, ilst.end)) {
    const data = child(b, item, 'data');
    if (!data || data.end - data.body < 8) continue;
    const kind = u32(b, data.body) & 0xffffff;
    const value = b.subarray(data.body + 8, data.end);
    const text = () => decodeUtf8(value).trim() || undefined;
    switch (item.type) {
      case '©nam':
        meta.title = text();
        break;
      case '©ART':
        meta.artist = text();
        break;
      case 'aART':
        meta.albumArtist = text();
        break;
      case '©alb':
        meta.album = text();
        break;
      case 'covr':
        if (value.length) meta.cover = new Blob([value], { type: kind === 14 ? 'image/png' : 'image/jpeg' });
        break;
    }
  }
}

/** Chapters stored as a QuickTime text track referenced by a `chap` track reference. */
async function readChapterTrack(file: Blob, b: Bytes, moov: Box): Promise<RawChapter[]> {
  const tracks = children(b, moov, 'trak').map((trak) => {
    const tkhd = child(b, trak, 'tkhd');
    const chap = child(b, trak, 'tref', 'chap');
    const hdlr = child(b, trak, 'mdia', 'hdlr');
    const refs: number[] = [];
    if (chap) for (let p = chap.body; p + 4 <= chap.end; p += 4) refs.push(u32(b, p));
    return {
      trak,
      id: tkhd ? u32(b, tkhd.body + (b[tkhd.body] === 1 ? 20 : 12)) : -1,
      refs,
      handler: hdlr ? ascii(b, hdlr.body + 8, 4) : '',
    };
  });
  const referenced = new Set(tracks.flatMap((t) => t.refs));
  const chapterTrack = referenced.size
    ? tracks.find((t) => referenced.has(t.id))
    : tracks.find((t) => t.handler === 'text');
  if (!chapterTrack) return [];

  const mdia = child(b, chapterTrack.trak, 'mdia');
  const mdhd = child(b, mdia, 'mdhd');
  const stbl = child(b, mdia, 'minf', 'stbl');
  if (!mdhd || !stbl) return [];
  const timescale = u32(b, mdhd.body + (b[mdhd.body] === 1 ? 20 : 12));
  const stts = child(b, stbl, 'stts');
  const stsz = child(b, stbl, 'stsz');
  const stsc = child(b, stbl, 'stsc');
  const stco = child(b, stbl, 'stco') ?? child(b, stbl, 'co64');
  if (!timescale || !stts || !stsz || !stsc || !stco) return [];

  // Sample start times.
  const times: number[] = [];
  let t = 0;
  for (let i = 0, n = u32(b, stts.body + 4); i < n; i++) {
    const p = stts.body + 8 + i * 8;
    const count = u32(b, p);
    const delta = u32(b, p + 4);
    for (let k = 0; k < count; k++, t += delta) times.push(t);
  }

  // Sample sizes.
  const fixedSize = u32(b, stsz.body + 4);
  const sampleCount = Math.min(u32(b, stsz.body + 8), times.length);
  const sizes = Array.from({ length: sampleCount }, (_, i) =>
    fixedSize || u32(b, stsz.body + 12 + i * 4),
  );

  // Sample file offsets: chunk offsets + sample-to-chunk mapping.
  const wide = stco.type === 'co64';
  const chunkCount = u32(b, stco.body + 4);
  const chunkOffset = (c: number) =>
    wide ? u64(b, stco.body + 8 + c * 8) : u32(b, stco.body + 8 + c * 4);
  const offsets: number[] = [];
  const runs = u32(b, stsc.body + 4);
  for (let r = 0; r < runs && offsets.length < sampleCount; r++) {
    const p = stsc.body + 8 + r * 12;
    const firstChunk = u32(b, p) - 1;
    const perChunk = u32(b, p + 4);
    const nextChunk = r + 1 < runs ? u32(b, p + 12) - 1 : chunkCount;
    for (let c = firstChunk; c < nextChunk && offsets.length < sampleCount; c++) {
      let offset = chunkOffset(c);
      for (let k = 0; k < perChunk && offsets.length < sampleCount; k++) {
        offsets.push(offset);
        offset += sizes[offsets.length - 1];
      }
    }
  }
  if (!offsets.length) return [];

  // Chapter titles are tiny and usually stored together: read them in one go when possible.
  const from = Math.min(...offsets);
  const to = Math.max(...offsets.map((o, i) => o + sizes[i]));
  const block = to - from <= 1024 * 1024 ? await readRange(file, from, to - from) : null;

  const chapters: RawChapter[] = [];
  for (let i = 0; i < offsets.length; i++) {
    const sample = block
      ? block.subarray(offsets[i] - from, offsets[i] - from + sizes[i])
      : await readRange(file, offsets[i], sizes[i]);
    if (sample.length < 2) continue;
    const raw = sample.subarray(2, 2 + u16(sample, 0));
    const utf16 = (raw[0] === 0xfe && raw[1] === 0xff) || (raw[0] === 0xff && raw[1] === 0xfe);
    chapters.push({ title: (utf16 ? decodeUtf16(raw, true) : decodeUtf8(raw)).trim(), start: times[i] / timescale });
  }
  return chapters;
}

/** Nero-style chapter list (`moov/udta/chpl`), times in 100 ns units. */
function readNeroChapters(b: Bytes, moov: Box): RawChapter[] {
  const chpl = child(b, moov, 'udta', 'chpl');
  if (!chpl) return [];
  let p = chpl.body;
  const version = b[p];
  p += 4;
  let count: number;
  if (version === 1) {
    count = u32(b, p + 1);
    p += 5;
  } else {
    count = b[p];
    p += 1;
  }
  const chapters: RawChapter[] = [];
  for (let i = 0; i < count && p + 9 <= chpl.end; i++) {
    const start = u64(b, p) / 1e7;
    const length = b[p + 8];
    p += 9;
    chapters.push({ title: decodeUtf8(b.subarray(p, p + length)).trim(), start });
    p += length;
  }
  return chapters;
}
