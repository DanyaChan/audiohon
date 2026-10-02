import { ascii, readRange, syncsafe, u24, u32, type Bytes } from './bytes';
import { decodeLegacy, decodeUtf16, decodeUtf8 } from './text';
import type { AudioMeta, RawChapter } from './types';

interface Frame {
  id: string;
  data: Bytes;
}

/** Reads an ID3v2 tag at the start of the file (MP3, AAC); ID3v1 is the fallback. */
export async function readId3(file: Blob): Promise<AudioMeta> {
  const meta: AudioMeta = { chapters: [] };
  const head = await readRange(file, 0, 10);
  const major = head[3];
  if (ascii(head, 0, 3) === 'ID3' && major >= 2 && major <= 4) {
    const flags = head[5];
    let tag = await readRange(file, 10, syncsafe(head, 6));
    if (flags & 0x80 && major < 4) tag = resync(tag);
    let start = 0;
    if (flags & 0x40 && major === 3) start = 4 + u32(tag, 0);
    if (flags & 0x40 && major === 4) start = syncsafe(tag, 0);
    applyFrames(parseFrames(tag, start, tag.length, major), major, meta);
  }
  if (!meta.title && !meta.album) await readId3v1(file, meta);
  return meta;
}

function parseFrames(b: Bytes, start: number, end: number, major: number): Frame[] {
  const frames: Frame[] = [];
  const idLength = major === 2 ? 3 : 4;
  const headerLength = major === 2 ? 6 : 10;
  let p = start;
  while (p + headerLength <= end) {
    const id = ascii(b, p, idLength);
    if (!/^[A-Z0-9]+$/.test(id)) break; // padding
    const size = major === 2 ? u24(b, p + 3) : major === 4 ? syncsafe(b, p + 4) : u32(b, p + 4);
    const format = major === 2 ? 0 : b[p + 9];
    let data = b.subarray(p + headerLength, Math.min(end, p + headerLength + size));
    p += headerLength + size;
    if (major === 4) {
      if (format & 0x0c) continue; // compressed or encrypted
      if (format & 0x40) data = data.subarray(1); // group id
      if (format & 0x01) data = data.subarray(4); // data length indicator
      if (format & 0x02) data = resync(data);
    } else if (major === 3) {
      if (format & 0xc0) continue; // compressed or encrypted
      if (format & 0x20) data = data.subarray(1); // group id
    }
    frames.push({ id, data });
  }
  return frames;
}

function applyFrames(frames: Frame[], major: number, meta: AudioMeta) {
  let coverType = -1;
  for (const { id, data } of frames) {
    switch (id) {
      case 'TIT2':
      case 'TT2':
        meta.title = textFrame(data);
        break;
      case 'TPE1':
      case 'TP1':
        meta.artist = textFrame(data);
        break;
      case 'TPE2':
      case 'TP2':
        meta.albumArtist = textFrame(data);
        break;
      case 'TALB':
      case 'TAL':
        meta.album = textFrame(data);
        break;
      case 'APIC':
      case 'PIC': {
        const picture = pictureFrame(data, id === 'PIC');
        // Prefer the front cover (type 3) over whatever came first.
        if (picture && (coverType === -1 || (picture.type === 3 && coverType !== 3))) {
          meta.cover = picture.blob;
          coverType = picture.type;
        }
        break;
      }
      case 'CHAP': {
        const chapter = chapterFrame(data, major);
        if (chapter) meta.chapters.push(chapter);
        break;
      }
    }
  }
  meta.chapters.sort((a, b) => a.start - b.start);
}

function decodeText(encoding: number, b: Bytes): string {
  switch (encoding) {
    case 1:
      return decodeUtf16(b);
    case 2:
      return decodeUtf16(b, true);
    case 3:
      return decodeUtf8(b);
    default:
      return decodeLegacy(b);
  }
}

function textFrame(data: Bytes): string | undefined {
  // ID3v2.4 allows several NUL-separated values; the first one is enough.
  const text = decodeText(data[0], data.subarray(1)).split('\0')[0].replace(/^﻿/, '').trim();
  return text || undefined;
}

/** Splits off a NUL-terminated string; returns it and the offset after the terminator. */
function terminated(b: Bytes, start: number, encoding: number): [string, number] {
  const wide = encoding === 1 || encoding === 2;
  let end = start;
  if (wide) {
    while (end + 1 < b.length && (b[end] !== 0 || b[end + 1] !== 0)) end += 2;
    return [decodeText(encoding, b.subarray(start, end)), end + 2];
  }
  while (end < b.length && b[end] !== 0) end++;
  return [decodeText(encoding, b.subarray(start, end)), end + 1];
}

function pictureFrame(data: Bytes, v22: boolean) {
  const encoding = data[0];
  let mime: string;
  let p: number;
  if (v22) {
    const format = ascii(data, 1, 3).toLowerCase();
    mime = format === 'png' ? 'image/png' : 'image/jpeg';
    p = 4;
  } else {
    [mime, p] = terminated(data, 1, 0);
    mime = mime.toLowerCase();
    if (!mime.includes('/')) mime = `image/${mime === 'jpg' ? 'jpeg' : mime || 'jpeg'}`;
  }
  const type = data[p];
  [, p] = terminated(data, p + 1, encoding);
  if (p >= data.length || mime === '-->') return null; // "-->" means a link, not image data
  return { type, blob: new Blob([data.subarray(p)], { type: mime }) };
}

function chapterFrame(data: Bytes, major: number): RawChapter | null {
  const [, p] = terminated(data, 0, 0);
  if (p + 16 > data.length) return null;
  const start = u32(data, p) / 1000;
  const sub = parseFrames(data, p + 16, data.length, major);
  const title = sub.find((f) => f.id === 'TIT2');
  return { title: (title && textFrame(title.data)) ?? '', start };
}

/** Undoes ID3 unsynchronisation: every 0xFF 0x00 pair becomes 0xFF. */
function resync(b: Bytes): Bytes {
  const out = new Uint8Array(b.length);
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    out[n++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, n);
}

async function readId3v1(file: Blob, meta: AudioMeta) {
  if (file.size < 128) return;
  const b = await readRange(file, file.size - 128, 128);
  if (ascii(b, 0, 3) !== 'TAG') return;
  const field = (o: number) => {
    let end = o;
    while (end < o + 30 && b[end] !== 0) end++;
    return decodeLegacy(b.subarray(o, end)).trim() || undefined;
  };
  meta.title ??= field(3);
  meta.artist ??= field(33);
  meta.album ??= field(63);
}
