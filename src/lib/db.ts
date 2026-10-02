import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Book, Bookmark, Collection, Progress } from '../types';

/**
 * Everything lives in IndexedDB: localStorage only holds a few megabytes of
 * strings, while audiobooks are hundreds of megabytes of binary data.
 */
interface Schema extends DBSchema {
  books: { key: string; value: Book };
  progress: { key: string; value: Progress };
  bookmarks: { key: string; value: Bookmark; indexes: { bookId: string } };
  collections: { key: string; value: Collection };
  /** Audio files and cover images, keyed by id. */
  files: { key: string; value: Blob };
}

let connection: Promise<IDBPDatabase<Schema>> | undefined;

export function db(): Promise<IDBPDatabase<Schema>> {
  connection ??= openDB<Schema>('audiohon', 1, {
    upgrade(database) {
      database.createObjectStore('books', { keyPath: 'id' });
      database.createObjectStore('progress', { keyPath: 'bookId' });
      database.createObjectStore('bookmarks', { keyPath: 'id' }).createIndex('bookId', 'bookId');
      database.createObjectStore('collections', { keyPath: 'id' });
      database.createObjectStore('files');
    },
    blocking() {
      // A newer version of the app was opened in another tab: let it upgrade.
      void connection?.then((d) => d.close());
      connection = undefined;
    },
  });
  return connection;
}

export async function loadAll() {
  const d = await db();
  const [books, progress, bookmarks, collections] = await Promise.all([
    d.getAll('books'),
    d.getAll('progress'),
    d.getAll('bookmarks'),
    d.getAll('collections'),
  ]);
  return { books, progress, bookmarks, collections };
}

export const getFile = async (id: string) => (await db()).get('files', id);
export const putFile = async (id: string, blob: Blob) => void (await (await db()).put('files', blob, id));
export const deleteFile = async (id: string) => (await db()).delete('files', id);

export const putBook = async (book: Book) => void (await (await db()).put('books', book));
export const putProgress = async (p: Progress) => void (await (await db()).put('progress', p));
export const putBookmark = async (b: Bookmark) => void (await (await db()).put('bookmarks', b));
export const deleteBookmark = async (id: string) => (await db()).delete('bookmarks', id);
export const putCollection = async (c: Collection) => void (await (await db()).put('collections', c));
export const deleteCollection = async (id: string) => (await db()).delete('collections', id);

/** Removes a book with its files, progress and bookmarks; `collections` are the updated ones. */
export async function deleteBookData(book: Book, collections: Collection[]) {
  const d = await db();
  const tx = d.transaction(['books', 'progress', 'bookmarks', 'collections', 'files'], 'readwrite');
  const bookmarks = tx.objectStore('bookmarks');
  const files = tx.objectStore('files');
  const keys = await bookmarks.index('bookId').getAllKeys(book.id);
  await Promise.all([
    tx.objectStore('books').delete(book.id),
    tx.objectStore('progress').delete(book.id),
    ...keys.map((k) => bookmarks.delete(k)),
    ...book.tracks.map((t) => files.delete(t.id)),
    ...(book.coverId ? [files.delete(book.coverId)] : []),
    ...collections.map((c) => tx.objectStore('collections').put(c)),
  ]);
  await tx.done;
}
