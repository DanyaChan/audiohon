import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { naturalCompare } from '../../lib/format';
import { library, useLibrary } from '../../store/library';
import { Cover } from '../Cover';
import { Modal } from '../Modal';

/** Which collections a book belongs to. */
export function BookCollectionsDialog({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const { books, collections } = useLibrary();
  const [name, setName] = useState('');
  const book = books.find((b) => b.id === bookId);
  if (!book) return null;

  return (
    <Modal
      title="Коллекции"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Готово
        </button>
      }
    >
      <p className="muted">«{book.title}»</p>
      {collections.length > 0 ? (
        <ul className="check-list">
          {collections.map((c) => (
            <li key={c.id}>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={c.bookIds.includes(book.id)}
                  onChange={(e) => library.setInCollection(book.id, c.id, e.target.checked)}
                />
                <span className="check-text">{c.name}</span>
                <span className="muted small">{c.bookIds.length}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Коллекций пока нет. Создайте первую:</p>
      )}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          library.createCollection(name, [book.id]);
          setName('');
        }}
      >
        <input
          className="input"
          placeholder="Новая коллекция"
          aria-label="Название новой коллекции"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn" disabled={!name.trim()}>
          <Plus size={16} /> Создать
        </button>
      </form>
    </Modal>
  );
}

/** Which books a collection contains. */
export function CollectionBooksDialog({ collectionId, onClose }: { collectionId: string; onClose: () => void }) {
  const { books, collections, covers } = useLibrary();
  const [query, setQuery] = useState('');
  const collection = collections.find((c) => c.id === collectionId);
  if (!collection) return null;

  const q = query.trim().toLowerCase();
  const list = books
    .filter((b) => !q || `${b.title} ${b.author}`.toLowerCase().includes(q))
    .sort((a, b) => naturalCompare(a.title, b.title));

  return (
    <Modal
      title={`Книги в «${collection.name}»`}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Готово
        </button>
      }
    >
      {books.length > 6 && (
        <label className="search search-block">
          <Search size={16} />
          <input type="search" placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      {books.length === 0 && <p className="muted">В библиотеке пока нет книг.</p>}
      <ul className="check-list">
        {list.map((b) => (
          <li key={b.id}>
            <label className="check-row">
              <input
                type="checkbox"
                checked={collection.bookIds.includes(b.id)}
                onChange={(e) => library.setInCollection(b.id, collection.id, e.target.checked)}
              />
              <Cover src={covers[b.id]} title={b.title} compact className="check-cover" />
              <span className="check-text">
                <span>{b.title}</span>
                {b.author && <span className="muted small">{b.author}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
