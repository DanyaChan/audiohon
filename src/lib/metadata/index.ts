import { ascii, readRange } from './bytes';
import { readId3 } from './id3';
import { readMp4 } from './mp4';
import type { AudioMeta } from './types';

export type { AudioMeta, RawChapter } from './types';
export { parseCue, type CueSheet } from './cue';

/** Tags, cover and embedded chapters. Never throws: unknown or broken files give empty metadata. */
export async function readAudioMeta(file: Blob): Promise<AudioMeta> {
  try {
    const head = await readRange(file, 0, 12);
    if (ascii(head, 4, 4) === 'ftyp') return await readMp4(file);
    return await readId3(file); // MP3/AAC; finds nothing in other formats
  } catch (error) {
    console.warn('Failed to read metadata', error);
    return { chapters: [] };
  }
}
