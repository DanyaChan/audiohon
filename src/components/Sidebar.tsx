import { CircleCheck, FolderHeart, Headphones, Library, Plus, Settings, Sparkles, type LucideIcon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { library, statusOf, useLibrary } from '../store/library';
import type { Collection } from '../types';
import { cls } from '../ui/cls';
import { filterHref, navigate, type Filter, type Route } from '../ui/route';
import { BOOK_DRAG_TYPE, useUI } from '../ui/ui';

interface SidebarProps {
  route: Route;
  open: boolean;
  onClose: () => void;
}

const isActive = (route: Route, filter: Filter) =>
  route.view === 'library' &&
  route.filter.kind === filter.kind &&
  (filter.kind !== 'collection' || (route.filter.kind === 'collection' && route.filter.id === filter.id));

export function Sidebar({ route, open, onClose }: SidebarProps) {
  const { books, progress, collections } = useLibrary();
  const ui = useUI();
  const [creating, setCreating] = useState(false);

  const counts = useMemo(() => {
    const result = { new: 0, listening: 0, finished: 0 };
    for (const book of books) result[statusOf(progress[book.id])]++;
    return result;
  }, [books, progress]);

  const smart: [Filter, LucideIcon, string, number][] = [
    [{ kind: 'all' }, Library, 'Все книги', books.length],
    [{ kind: 'listening' }, Headphones, 'Слушаю', counts.listening],
    [{ kind: 'new' }, Sparkles, 'Новые', counts.new],
    [{ kind: 'finished' }, CircleCheck, 'Прослушано', counts.finished],
  ];

  return (
    <>
      <div className={cls('scrim', open && 'visible')} onClick={onClose} />
      <aside className={cls('sidebar', open && 'open')}>
        <a className="brand" href="#/" onClick={onClose}>
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={28} height={28} />
          <span>Audiohon</span>
        </a>
        <nav className="nav" aria-label="Библиотека">
          {smart.map(([filter, Icon, label, count]) => (
            <a
              key={filter.kind}
              href={filterHref(filter)}
              className={cls('nav-item', isActive(route, filter) && 'active')}
              onClick={onClose}
            >
              <Icon size={18} />
              <span className="nav-label">{label}</span>
              {count > 0 && <span className="nav-count">{count}</span>}
            </a>
          ))}

          <div className="nav-heading">
            <span>Коллекции</span>
            <button type="button" className="icon-btn small" onClick={() => setCreating(true)} aria-label="Новая коллекция" title="Новая коллекция">
              <Plus size={16} />
            </button>
          </div>
          {collections.map((c) => (
            <CollectionLink
              key={c.id}
              collection={c}
              active={isActive(route, { kind: 'collection', id: c.id })}
              onClick={onClose}
              onDropBook={(bookId) => {
                const book = library.book(bookId);
                if (!book) return;
                library.setInCollection(bookId, c.id, true);
                ui.toast(`«${book.title}» — в коллекции «${c.name}»`);
              }}
            />
          ))}
          {creating && (
            <NewCollection
              onDone={(name) => {
                setCreating(false);
                if (!name) return;
                const collection = library.createCollection(name);
                navigate(filterHref({ kind: 'collection', id: collection.id }));
                onClose();
              }}
            />
          )}
          {!collections.length && !creating && (
            <p className="nav-hint">
              Коллекции помогают группировать книги: «Фантастика», «Для детей», «На потом». Книгу можно перетащить на
              коллекцию прямо из библиотеки.
            </p>
          )}
        </nav>
        <div className="sidebar-footer">
          <button
            type="button"
            className="nav-item"
            onClick={() => {
              onClose();
              ui.openDialog({ kind: 'settings' });
            }}
          >
            <Settings size={18} />
            <span className="nav-label">Настройки</span>
          </button>
        </div>
      </aside>
    </>
  );
}

interface CollectionLinkProps {
  collection: Collection;
  active: boolean;
  onClick: () => void;
  onDropBook: (bookId: string) => void;
}

/** A sidebar link that books can be dropped onto. */
function CollectionLink({ collection, active, onClick, onDropBook }: CollectionLinkProps) {
  const [over, setOver] = useState(false);
  return (
    <a
      href={filterHref({ kind: 'collection', id: collection.id })}
      className={cls('nav-item', active && 'active', over && 'drop-target')}
      onClick={onClick}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(BOOK_DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const bookId = e.dataTransfer.getData(BOOK_DRAG_TYPE);
        if (!bookId) return;
        e.preventDefault();
        e.stopPropagation();
        onDropBook(bookId);
      }}
    >
      <FolderHeart size={18} />
      <span className="nav-label">{collection.name}</span>
      {collection.bookIds.length > 0 && <span className="nav-count">{collection.bookIds.length}</span>}
    </a>
  );
}

function NewCollection({ onDone }: { onDone: (name: string) => void }) {
  const [name, setName] = useState('');
  const finished = useRef(false);
  // Enter, Escape and blur can all end editing; only the first one counts.
  const finish = (value: string) => {
    if (finished.current) return;
    finished.current = true;
    onDone(value);
  };
  return (
    <form
      className="nav-new"
      onSubmit={(e) => {
        e.preventDefault();
        finish(name.trim());
      }}
    >
      <FolderHeart size={18} />
      <input
        className="input"
        autoFocus
        placeholder="Название коллекции"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => finish(name.trim())}
        onKeyDown={(e) => {
          if (e.key === 'Escape') finish('');
        }}
      />
    </form>
  );
}
