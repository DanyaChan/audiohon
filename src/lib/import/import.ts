import { library } from '../../store/library';
import type { Book, Track } from '../../types';
import { deleteFile, putFile } from '../db';
import { naturalCompare } from '../format';
import { uid } from '../id';
import { parseCue, readAudioMeta } from '../metadata';
import { decodeTextFile } from '../metadata/text';
import { extension, trackTitles, type Analysis, type AudioFile, type Draft, type SourceFile } from './grouping';

const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  webm: 'audio/webm',
  weba: 'audio/webm',
};
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);

export async function analyze(
  sources: SourceFile[],
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Analysis> {
  const audioSources = sources.filter(
    (s) => AUDIO_TYPES[extension(s.path)] || s.file.type.startsWith('audio/'),
  );
  const images = sources.filter((s) => IMAGE_EXTENSIONS.has(extension(s.path)));
  const cues = (
    await Promise.all(
      sources
        .filter((s) => extension(s.path) === 'cue')
        .map(async (s) => {
          try {
            return { path: s.path, sheet: parseCue(decodeTextFile(new Uint8Array(await s.file.arrayBuffer()))) };
          } catch {
            return null; // an unreadable cue sheet just means no chapters from it
          }
        }),
    )
  ).filter((cue) => cue !== null);

  const audio: AudioFile[] = [];
  const skipped: string[] = [];
  let done = 0;
  onProgress(0, audioSources.length);
  await inParallel(audioSources, 3, async (source) => {
    if (signal?.aborted) return;
    const type = AUDIO_TYPES[extension(source.path)] ?? source.file.type;
    // Files often come without a MIME type (m4b especially); some browsers need it to play a blob.
    const blob = source.file.type === type ? source.file : new Blob([source.file], { type });
    const [meta, duration] = await Promise.all([readAudioMeta(blob), probeDuration(blob)]);
    if (duration > 0) audio.push({ source, blob, meta, duration });
    else skipped.push(source.path);
    onProgress(++done, audioSources.length);
  });
  audio.sort((a, b) => naturalCompare(a.source.path, b.source.path));
  return { audio, images, cues, skipped };
}

async function inParallel<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Duration as the browser sees it; NaN if the browser cannot play the file. */
function probeDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(blob);
    let settled = false;
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timeout = setTimeout(() => finish(NaN), 30_000);
    audio.preload = 'metadata';
    audio.addEventListener('error', () => finish(NaN));
    audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(audio.duration)) return finish(audio.duration);
      // Some files report an infinite duration until the browser scans to the end.
      audio.addEventListener('durationchange', () => {
        if (Number.isFinite(audio.duration)) finish(audio.duration);
      });
      audio.currentTime = 1e7;
    });
    audio.src = url;
  });
}

/** Stores the files of a draft and adds the book to the library. */
export async function saveDraft(draft: Draft, onProgress: (bytes: number) => void): Promise<Book> {
  const written: string[] = [];
  try {
    const titles = trackTitles(draft.files);
    const tracks: Track[] = [];
    let bytes = 0;
    for (const [i, f] of draft.files.entries()) {
      const id = uid();
      await putFile(id, f.blob);
      written.push(id);
      bytes += f.blob.size;
      onProgress(bytes);
      tracks.push({ id, path: f.source.path, title: titles[i], duration: f.duration, size: f.blob.size, type: f.blob.type });
    }
    const cover = draft.cover ? await makeThumbnail(draft.cover) : null;
    const coverId = cover ? uid() : null;
    if (cover && coverId) {
      await putFile(coverId, cover);
      written.push(coverId);
    }
    const book: Book = {
      id: uid(),
      title: draft.title.trim() || 'Без названия',
      author: draft.author.trim(),
      coverId,
      tracks,
      chapters: draft.chapters,
      duration: draft.duration,
      addedAt: Date.now(),
    };
    await library.addBook(book, cover);
    return book;
  } catch (error) {
    await Promise.all(written.map((id) => deleteFile(id).catch(() => undefined)));
    throw error;
  }
}

/** Downscales a cover image so that the library does not keep multi-megabyte pictures around. */
export async function makeThumbnail(image: Blob, size = 640): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(image);
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && image.size < 400_000) {
      bitmap.close();
      return image;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? image), 'image/jpeg', 0.86));
  } catch {
    return null; // not an image the browser can decode
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) || ((await navigator.storage?.persist?.()) ?? false);
  } catch {
    return false;
  }
}
