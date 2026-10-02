import type { Chapter } from '../../types';
import type { AudioMeta, CueSheet, RawChapter } from '../metadata';
import { sum, unique } from '../util';

export interface SourceFile {
  file: File;
  /** Relative path with "/" separators, including the file name. */
  path: string;
}

export interface AudioFile {
  source: SourceFile;
  /** The file with a MIME type the browser understands. */
  blob: Blob;
  meta: AudioMeta;
  duration: number;
}

export interface Analysis {
  /** Playable files in natural path order. */
  audio: AudioFile[];
  images: SourceFile[];
  cues: { path: string; sheet: CueSheet }[];
  /** Audio files the browser cannot play. */
  skipped: string[];
}

/** How to split the imported files into books. */
export type GroupMode = 'single' | 'folders' | 'files';

export interface Draft {
  key: string;
  title: string;
  author: string;
  files: AudioFile[];
  cover: Blob | null;
  chapters: Chapter[];
  duration: number;
  size: number;
}

export const dirname = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const filename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
/** File name without the extension. */
export const stem = (path: string) => filename(path).replace(/\.[^.]+$/, '') || filename(path);
export const extension = (path: string) => /\.([^./]+)$/.exec(path)?.[1].toLowerCase() ?? '';

/** Folders like "CD1", "Disc 2", "Часть 3" are parts of one book. */
const PART_FOLDER = /^(cd|disc|disk|part|часть|диск|том|vol(ume)?)?[\s._-]*\d+$/i;

export function suggestMode(analysis: Analysis): GroupMode {
  const dirs = unique(analysis.audio.map((f) => dirname(f.source.path) || '.'));
  if (dirs.length > 1) {
    const parents = new Set(dirs.map(dirname));
    const parts = parents.size === 1 && dirs.every((d) => PART_FOLDER.test(filename(d)));
    return parts ? 'single' : 'folders';
  }
  // Several m4b files (or files with their own chapters) are most likely separate books.
  const standalone =
    analysis.audio.length > 1 &&
    analysis.audio.every((f) => extension(f.source.path) === 'm4b' || f.meta.chapters.length > 1);
  return standalone ? 'files' : 'single';
}

export function buildDrafts(analysis: Analysis, mode: GroupMode): Draft[] {
  let groups: AudioFile[][];
  if (mode === 'files') {
    groups = analysis.audio.map((f) => [f]);
  } else if (mode === 'folders') {
    const byDir = new Map<string, AudioFile[]>();
    for (const f of analysis.audio) {
      const dir = dirname(f.source.path);
      byDir.set(dir, [...(byDir.get(dir) ?? []), f]);
    }
    groups = [...byDir.values()];
  } else {
    groups = [analysis.audio];
  }
  return groups.filter((g) => g.length).map((files, i) => makeDraft(files, analysis, i));
}

function makeDraft(files: AudioFile[], analysis: Analysis, index: number): Draft {
  const first = files[0];
  const folder = commonDir(files.map((f) => f.source.path));
  const cue = matchCue(files, analysis.cues);
  const albums = unique(files.map((f) => f.meta.album));
  // "01.mp3" or "Track 3.mp3" says less about the book than the folder it is in.
  const genericName = /^[\s\d._-]*((track|трек|part|часть|chapter|глава)[\s\d._-]*)?$/i.test(stem(first.source.path));
  const name = folder && (files.length > 1 || genericName) ? filename(folder) : stem(first.source.path);

  const title =
    files.length === 1
      ? (first.meta.title ?? first.meta.album ?? cue?.sheet.title ?? name)
      : (albums[0] ?? cue?.sheet.title ?? name);
  const author = first.meta.albumArtist ?? first.meta.artist ?? cue?.sheet.performer ?? '';

  return {
    key: `${index}:${first.source.path}`,
    title,
    author,
    files,
    cover: pickCover(files, analysis.images),
    chapters: buildChapters(files, cue?.chapters),
    duration: sum(files.map((f) => f.duration)),
    size: sum(files.map((f) => f.blob.size)),
  };
}

function commonDir(paths: string[]): string {
  let common = dirname(paths[0]);
  for (const p of paths) {
    while (common && p !== common && !p.startsWith(`${common}/`)) common = dirname(common);
  }
  return common;
}

/** Display titles of the files: their tags when those are distinct, the file names otherwise. */
export function trackTitles(files: AudioFile[]): string[] {
  const tagged = files.map((f) => f.meta.title);
  const usable = files.length === 1 || (tagged.every(Boolean) && new Set(tagged).size === tagged.length);
  return files.map((f, i) => (usable && tagged[i]) || stem(f.source.path));
}

/** Chapters of a cue sheet, per audio file. */
function matchCue(files: AudioFile[], cues: Analysis['cues']) {
  for (const cue of cues) {
    const chapters = new Map<AudioFile, RawChapter[]>();
    for (const entry of cue.sheet.files) {
      const name = stem(entry.name.replace(/\\/g, '/')).toLowerCase();
      const target =
        cue.sheet.files.length === 1 && files.length === 1
          ? files[0]
          : files.find((f) => stem(f.source.path).toLowerCase() === name);
      if (target) chapters.set(target, entry.tracks.map((t) => ({ title: t.title, start: t.start })));
    }
    if (chapters.size) return { sheet: cue.sheet, chapters };
  }
  return undefined;
}

/**
 * The table of contents: chapters embedded in the files (or from a cue sheet)
 * where there are any, otherwise one chapter per file.
 */
export function buildChapters(files: AudioFile[], cueChapters?: Map<AudioFile, RawChapter[]>): Chapter[] {
  const titles = trackTitles(files);
  const chapters: Chapter[] = [];
  let offset = 0;
  files.forEach((file, i) => {
    const own = (cueChapters?.get(file) ?? file.meta.chapters).filter((c) => c.start < file.duration - 0.5);
    if (!own.length || (own.length === 1 && !own[0].title)) {
      chapters.push({ title: titles[i], start: offset });
    } else {
      if (own[0].start > 1) chapters.push({ title: titles[i], start: offset });
      for (const c of own) {
        chapters.push({ title: c.title || `Глава ${chapters.length + 1}`, start: offset + c.start });
      }
    }
    offset += file.duration;
  });

  const sorted = chapters.sort((a, b) => a.start - b.start);
  const result: Chapter[] = [];
  for (const c of sorted) {
    const prev = result[result.length - 1];
    if (!prev || c.start - prev.start >= 0.5) result.push(c);
  }
  if (result.length) result[0] = { ...result[0], start: 0 };
  return result;
}

function pickCover(files: AudioFile[], images: SourceFile[]): Blob | null {
  const dirs = new Set(files.map((f) => dirname(f.source.path)));
  const folder = commonDir(files.map((f) => f.source.path));
  const local = images.filter((img) => dirs.has(dirname(img.path)));
  const candidates = local.length
    ? local
    : images.filter((img) => dirname(img.path) === folder || img.path.startsWith(`${folder}/`));
  const named = candidates.find((img) => /cover|folder|front|обложк/i.test(stem(img.path)));
  const embedded = files.find((f) => f.meta.cover)?.meta.cover;
  const largest = [...candidates].sort((a, b) => b.file.size - a.file.size)[0];
  return named?.file ?? embedded ?? largest?.file ?? null;
}
