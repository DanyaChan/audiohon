import type { Bytes } from './bytes';

const utf8 = new TextDecoder('utf-8');
const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const utf16le = new TextDecoder('utf-16le');
const utf16be = new TextDecoder('utf-16be');
const latin1 = new TextDecoder('windows-1252');
const cp1251 = new TextDecoder('windows-1251');

export const decodeUtf8 = (b: Bytes) => utf8.decode(b);

/** UTF-16 with an optional byte order mark (little endian without one). */
export function decodeUtf16(b: Bytes, bigEndian = false): string {
  if (b[0] === 0xfe && b[1] === 0xff) return utf16be.decode(b.subarray(2));
  if (b[0] === 0xff && b[1] === 0xfe) return utf16le.decode(b.subarray(2));
  return (bigEndian ? utf16be : utf16le).decode(b);
}

/**
 * Text in an unknown 8-bit encoding. Tags and cue sheets of Russian audiobooks
 * are often in cp1251 while claiming to be Latin-1, so: valid UTF-8 wins, then
 * mostly-Cyrillic byte patterns are read as cp1251.
 */
export function decodeLegacy(b: Bytes): string {
  let high = 0;
  let cyrillic = 0;
  let latin = 0;
  for (const c of b) {
    if (c >= 0x80) {
      high++;
      if (c >= 0xc0 || c === 0xa8 || c === 0xb8) cyrillic++;
    } else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) {
      latin++;
    }
  }
  if (high === 0) return latin1.decode(b);
  try {
    return utf8Strict.decode(b);
  } catch {
    return cyrillic > latin && cyrillic >= high * 0.8 ? cp1251.decode(b) : latin1.decode(b);
  }
}

/** A whole text file (e.g. a cue sheet): honours a BOM, otherwise guesses. */
export function decodeTextFile(b: Bytes): string {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return utf8.decode(b.subarray(3));
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) return decodeUtf16(b);
  return decodeLegacy(b);
}
