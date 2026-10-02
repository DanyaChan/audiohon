import type { Book, Chapter } from '../types';

/** Positions this close before a chapter start already count as that chapter. */
const EPSILON = 0.05;

/** Index of the chapter playing at `position`, or -1 if there are no chapters. */
export function chapterIndexAt(chapters: Chapter[], position: number): number {
  let lo = 0;
  let hi = chapters.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chapters[mid].start <= position + EPSILON) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return chapters.length ? Math.max(found, 0) : -1;
}

export interface ChapterSpan {
  index: number;
  title: string;
  start: number;
  end: number;
}

export function chapterAt(book: Book, position: number): ChapterSpan {
  const index = chapterIndexAt(book.chapters, position);
  if (index < 0) return { index: 0, title: book.title, start: 0, end: book.duration };
  return chapterSpan(book, index);
}

export function chapterSpan(book: Book, index: number): ChapterSpan {
  const chapter = book.chapters[index];
  const next = book.chapters[index + 1];
  return { index, title: chapter.title, start: chapter.start, end: next ? next.start : book.duration };
}

/** Start offsets of the tracks on the book timeline. */
export function trackOffsets(book: Book): number[] {
  let offset = 0;
  return book.tracks.map((t) => {
    const start = offset;
    offset += t.duration;
    return start;
  });
}
