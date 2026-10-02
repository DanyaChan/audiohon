import { useSyncExternalStore } from 'react';
import * as db from '../lib/db';
import { naturalCompare } from '../lib/format';
import { uid } from '../lib/id';
import type { Book, Bookmark, Collection, Progress } from '../types';

export interface LibraryState {
  ready: boolean;
  books: Book[];
  progress: Record<string, Progress>;
  /** Per book, sorted by position. */
  bookmarks: Record<string, Bookmark[]>;
  /** Sorted by name. */
  collections: Collection[];
  /** Object URLs of the cover images, per book. */
  covers: Record<string, string>;
}

export type Status = 'new' | 'listening' | 'finished';

export const statusOf = (p: Progress | undefined): Status =>
  !p ? 'new' : p.finished ? 'finished' : p.position > 0 || p.lastPlayedAt > 0 ? 'listening' : 'new';

const byPosition = (a: Bookmark, b: Bookmark) => a.position - b.position;

/**
 * The latest progress write, mirrored synchronously: an IndexedDB write issued
 * while the tab is closing may never complete, a localStorage one always does.
 */
const PROGRESS_BACKUP_KEY = 'audiohon:progress-backup';

function readProgressBackup(): Progress | null {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_BACKUP_KEY) ?? 'null');
  } catch {
    return null;
  }
}
const byName = (list: Collection[]) => [...list].sort((a, b) => naturalCompare(a.name, b.name));

const without = <T>(record: Record<string, T>, key: string) => {
  const copy = { ...record };
  delete copy[key];
  return copy;
};

class Library {
  private state: LibraryState = {
    ready: false,
    books: [],
    progress: {},
    bookmarks: {},
    collections: [],
    covers: {},
  };
  private listeners = new Set<() => void>();

  /** Called when a background write to IndexedDB fails. */
  onError: (error: unknown) => void = (error) => console.error(error);
  /** Called after another tab saved progress (the state already reflects it). */
  onExternalProgress: (progress: Progress) => void = () => {};

  constructor() {
    window.addEventListener('storage', (e) => {
      if (e.key !== PROGRESS_BACKUP_KEY || !e.newValue) return;
      let progress: Progress;
      try {
        progress = JSON.parse(e.newValue);
      } catch {
        return;
      }
      if (!this.book(progress.bookId)) return;
      this.set({ progress: { ...this.state.progress, [progress.bookId]: progress } });
      this.onExternalProgress(progress);
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  private set(patch: Partial<LibraryState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private persist(write: Promise<unknown>) {
    write.catch(this.onError);
  }

  async load() {
    const data = await db.loadAll();
    const covers: Record<string, string> = {};
    await Promise.all(
      data.books.map(async (book) => {
        const blob = book.coverId ? await db.getFile(book.coverId) : undefined;
        if (blob) covers[book.id] = URL.createObjectURL(blob);
      }),
    );
    const bookmarks: Record<string, Bookmark[]> = {};
    for (const b of data.bookmarks) (bookmarks[b.bookId] ??= []).push(b);
    for (const list of Object.values(bookmarks)) list.sort(byPosition);
    const progress = Object.fromEntries(data.progress.map((p) => [p.bookId, p]));
    const backup = readProgressBackup();
    if (backup && data.books.some((b) => b.id === backup.bookId)) {
      progress[backup.bookId] = backup;
      this.persist(db.putProgress(backup));
    }
    this.set({
      ready: true,
      books: data.books,
      progress,
      bookmarks,
      collections: byName(data.collections),
      covers,
    });
  }

  book = (id: string) => this.state.books.find((b) => b.id === id);

  progressOf = (bookId: string): Progress =>
    this.state.progress[bookId] ?? { bookId, position: 0, rate: 1, finished: false, lastPlayedAt: 0 };

  // Books

  /** The book's files must already be stored. */
  async addBook(book: Book, cover: Blob | null) {
    await db.putBook(book);
    const covers = cover ? { ...this.state.covers, [book.id]: URL.createObjectURL(cover) } : this.state.covers;
    this.set({ books: [...this.state.books, book], covers });
  }

  /** `cover`: a new image, `null` to remove the cover, `undefined` to keep it. */
  async updateBook(id: string, patch: Pick<Book, 'title' | 'author'>, cover?: Blob | null) {
    const book = this.book(id);
    if (!book) return;
    const next: Book = { ...book, ...patch };
    if (cover !== undefined) {
      next.coverId = cover ? uid() : null;
      if (cover && next.coverId) await db.putFile(next.coverId, cover);
    }
    await db.putBook(next);

    let covers = this.state.covers;
    if (cover !== undefined) {
      if (book.coverId) this.persist(db.deleteFile(book.coverId));
      if (covers[id]) URL.revokeObjectURL(covers[id]);
      covers = without(covers, id);
      if (cover) covers[id] = URL.createObjectURL(cover);
    }
    this.set({ books: this.state.books.map((b) => (b.id === id ? next : b)), covers });
  }

  async deleteBook(id: string) {
    const book = this.book(id);
    if (!book) return;
    const updated = this.state.collections
      .filter((c) => c.bookIds.includes(id))
      .map((c) => ({ ...c, bookIds: c.bookIds.filter((b) => b !== id) }));
    await db.deleteBookData(book, updated);
    if (this.state.covers[id]) URL.revokeObjectURL(this.state.covers[id]);
    this.set({
      books: this.state.books.filter((b) => b.id !== id),
      progress: without(this.state.progress, id),
      bookmarks: without(this.state.bookmarks, id),
      covers: without(this.state.covers, id),
      collections: this.state.collections.map((c) => updated.find((u) => u.id === c.id) ?? c),
    });
  }

  // Progress

  saveProgress(bookId: string, patch: Partial<Omit<Progress, 'bookId'>>) {
    if (!this.book(bookId)) return;
    const next = { ...this.progressOf(bookId), ...patch };
    this.set({ progress: { ...this.state.progress, [bookId]: next } });
    this.persist(db.putProgress(next));
    try {
      localStorage.setItem(PROGRESS_BACKUP_KEY, JSON.stringify(next));
    } catch {
      // IndexedDB still has it, unless the tab is closing right now.
    }
  }

  // Bookmarks

  addBookmark(bookId: string, position: number, note = ''): Bookmark {
    const bookmark: Bookmark = { id: uid(), bookId, position, note, createdAt: Date.now() };
    this.setBookmarks(bookId, [...(this.state.bookmarks[bookId] ?? []), bookmark]);
    this.persist(db.putBookmark(bookmark));
    return bookmark;
  }

  updateBookmark(bookmark: Bookmark, note: string) {
    const next = { ...bookmark, note };
    this.setBookmarks(bookmark.bookId, (this.state.bookmarks[bookmark.bookId] ?? []).map((b) => (b.id === next.id ? next : b)));
    this.persist(db.putBookmark(next));
  }

  removeBookmark(bookmark: Bookmark) {
    this.setBookmarks(bookmark.bookId, (this.state.bookmarks[bookmark.bookId] ?? []).filter((b) => b.id !== bookmark.id));
    this.persist(db.deleteBookmark(bookmark.id));
  }

  private setBookmarks(bookId: string, list: Bookmark[]) {
    this.set({ bookmarks: { ...this.state.bookmarks, [bookId]: [...list].sort(byPosition) } });
  }

  // Collections

  createCollection(name: string, bookIds: string[] = []): Collection {
    const collection: Collection = { id: uid(), name: name.trim(), bookIds, createdAt: Date.now() };
    this.set({ collections: byName([...this.state.collections, collection]) });
    this.persist(db.putCollection(collection));
    return collection;
  }

  renameCollection(id: string, name: string) {
    this.updateCollection(id, (c) => ({ ...c, name: name.trim() || c.name }));
  }

  deleteCollection(id: string) {
    this.set({ collections: this.state.collections.filter((c) => c.id !== id) });
    this.persist(db.deleteCollection(id));
  }

  setInCollection(bookId: string, collectionId: string, member: boolean) {
    this.updateCollection(collectionId, (c) => {
      if (c.bookIds.includes(bookId) === member) return c;
      return { ...c, bookIds: member ? [...c.bookIds, bookId] : c.bookIds.filter((id) => id !== bookId) };
    });
  }

  private updateCollection(id: string, update: (c: Collection) => Collection) {
    const current = this.state.collections.find((c) => c.id === id);
    if (!current) return;
    const next = update(current);
    if (next === current) return;
    this.set({ collections: byName(this.state.collections.map((c) => (c.id === id ? next : c))) });
    this.persist(db.putCollection(next));
  }
}

export const library = new Library();

export const useLibrary = () => useSyncExternalStore(library.subscribe, library.getState);
