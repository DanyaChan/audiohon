export interface Track {
  /** Key of the audio blob in the `files` store. */
  id: string;
  /** Path of the source file, relative to the imported folder. */
  path: string;
  title: string;
  /** Seconds. */
  duration: number;
  size: number;
  type: string;
}

export interface Chapter {
  title: string;
  /** Seconds on the book timeline (all tracks played back to back). */
  start: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  /** Key of the cover image in the `files` store. */
  coverId: string | null;
  tracks: Track[];
  /** Table of contents, sorted by `start`; the first chapter starts at 0. */
  chapters: Chapter[];
  duration: number;
  addedAt: number;
}

export interface Progress {
  bookId: string;
  /** Seconds on the book timeline. */
  position: number;
  rate: number;
  finished: boolean;
  /** 0 if the book has never been played. */
  lastPlayedAt: number;
}

export interface Bookmark {
  id: string;
  bookId: string;
  position: number;
  note: string;
  createdAt: number;
}

export interface Collection {
  id: string;
  name: string;
  bookIds: string[];
  createdAt: number;
}
