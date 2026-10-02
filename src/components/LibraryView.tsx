import { Ellipsis, FolderOpen, FolderPlus, Menu, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { naturalCompare } from '../lib/format';
import { usePlayerSelector } from '../player/player';
import { library, statusOf, useLibrary } from '../store/library';
import type { Book, Collection } from '../types';
import { navigate, type Filter } from '../ui/route';
import { useUI } from '../ui/ui';
import { BookCard } from './BookCard';
import { MenuItem, Popover } from './Popover';

type Sort = 'recent' | 'added' | 'title' | 'author';

const SORTS: Record<Sort, string> = {
  recent: 'Недавно слушал',
  added: 'Недавно добавленные',
  title: 'По названию',
  author: 'По автору',
};

const TITLES: Record<Exclude<Filter['kind'], 'collection'>, string> = {
  all: 'Все книги',
  listening: 'Слушаю',
  new: 'Новые',
  finished: 'Прослушано',
};

const SORT_KEY = 'audiohon:sort';
const canPickFolders = 'webkitdirectory' in document.createElement('input');

function readSort(): Sort {
  try {
    const value = localStorage.getItem(SORT_KEY);
    return value && value in SORTS ? (value as Sort) : 'recent';
  } catch {
    return 'recent';
  }
}

export function LibraryView({ filter }: { filter: Filter }) {
  const { books, progress, covers, collections } = useLibrary();
  const currentId = usePlayerSelector((s) => s.book?.id);
  const playing = usePlayerSelector((s) => s.playing);
  const ui = useUI();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>(readSort);
  const collection = filter.kind === 'collection' ? collections.find((c) => c.id === filter.id) : undefined;

  const visible = useMemo(() => {
    let list: Book[] = books;
    if (filter.kind === 'collection') {
      const ids = new Set(collection?.bookIds);
      list = list.filter((b) => ids.has(b.id));
    } else if (filter.kind !== 'all') {
      list = list.filter((b) => statusOf(progress[b.id]) === filter.kind);
    }
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((b) => `${b.title} ${b.author}`.toLowerCase().includes(q));
    const lastPlayed = (b: Book) => progress[b.id]?.lastPlayedAt ?? 0;
    const compare: Record<Sort, (a: Book, b: Book) => number> = {
      recent: (a, b) => lastPlayed(b) - lastPlayed(a) || b.addedAt - a.addedAt,
      added: (a, b) => b.addedAt - a.addedAt,
      title: (a, b) => naturalCompare(a.title, b.title),
      author: (a, b) => naturalCompare(a.author || '￿', b.author || '￿') || naturalCompare(a.title, b.title),
    };
    return [...list].sort(compare[sort]);
  }, [books, progress, filter, collection, query, sort]);

  if (filter.kind === 'collection' && !collection) {
    return (
      <div className="view">
        <Toolbar title="Коллекция не найдена" />
        <div className="empty">
          <p>Возможно, её удалили.</p>
          <a className="btn" href="#/">
            К библиотеке
          </a>
        </div>
      </div>
    );
  }

  let content;
  if (!books.length) {
    content = <EmptyLibrary />;
  } else if (collection && !collection.bookIds.length) {
    content = (
      <div className="empty">
        <FolderOpen size={40} strokeWidth={1.5} />
        <h2>В коллекции пока нет книг</h2>
        <p>Добавьте книги из библиотеки или перетащите обложку книги на коллекцию в боковой панели.</p>
        <button type="button" className="btn btn-primary" onClick={() => ui.openDialog({ kind: 'collection-books', collectionId: collection.id })}>
          <Plus size={18} /> Добавить книги
        </button>
      </div>
    );
  } else if (!visible.length) {
    content = (
      <div className="empty">
        <p>{query ? 'Ничего не найдено' : 'В этом разделе пока нет книг'}</p>
      </div>
    );
  } else {
    content = (
      <div className="library-grid">
        {visible.map((book) => (
          <BookCard
            key={book.id}
            book={book}
            progress={library.progressOf(book.id)}
            cover={covers[book.id]}
            current={book.id === currentId}
            playing={book.id === currentId && playing}
            collection={collection}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="view library-view">
      <Toolbar title={collection?.name ?? TITLES[filter.kind as keyof typeof TITLES]} collection={collection}>
        {books.length > 0 && (
          <>
            <label className="search">
              <Search size={16} />
              <input
                type="search"
                placeholder="Поиск"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Поиск по названию и автору"
              />
            </label>
            <select
              className="select"
              value={sort}
              aria-label="Сортировка"
              onChange={(e) => {
                const value = e.target.value as Sort;
                setSort(value);
                try {
                  localStorage.setItem(SORT_KEY, value);
                } catch {
                  // The choice just won't be remembered.
                }
              }}
            >
              {Object.entries(SORTS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </>
        )}
        <AddButton />
      </Toolbar>
      {content}
    </div>
  );
}

function Toolbar({ title, collection, children }: { title: string; collection?: Collection; children?: ReactNode }) {
  const ui = useUI();
  const [renaming, setRenaming] = useState(false);
  return (
    <header className="toolbar">
      <button type="button" className="icon-btn menu-btn" onClick={ui.openMenu} aria-label="Меню">
        <Menu size={22} />
      </button>
      {collection && renaming ? (
        <RenameForm
          name={collection.name}
          onDone={(name) => {
            setRenaming(false);
            if (name) library.renameCollection(collection.id, name);
          }}
        />
      ) : (
        <h1 className="toolbar-title">{title}</h1>
      )}
      {collection && !renaming && <CollectionMenu collection={collection} onRename={() => setRenaming(true)} />}
      <div className="toolbar-actions">{children}</div>
    </header>
  );
}

function RenameForm({ name, onDone }: { name: string; onDone: (name: string) => void }) {
  const [value, setValue] = useState(name);
  const finished = useRef(false);
  const finish = (result: string) => {
    if (finished.current) return;
    finished.current = true;
    onDone(result);
  };
  return (
    <form
      className="rename-form"
      onSubmit={(e) => {
        e.preventDefault();
        finish(value.trim());
      }}
    >
      <input
        className="input"
        autoFocus
        value={value}
        aria-label="Название коллекции"
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => finish(value.trim())}
        onKeyDown={(e) => {
          if (e.key === 'Escape') finish('');
        }}
      />
    </form>
  );
}

function CollectionMenu({ collection, onRename }: { collection: Collection; onRename: () => void }) {
  const ui = useUI();
  return (
    <Popover label="Действия с коллекцией" button={<Ellipsis size={20} />}>
      {(close) => (
        <div className="menu" role="menu">
          <MenuItem
            icon={<Plus size={16} />}
            onClick={() => {
              close();
              ui.openDialog({ kind: 'collection-books', collectionId: collection.id });
            }}
          >
            Добавить или убрать книги…
          </MenuItem>
          <MenuItem
            icon={<Pencil size={16} />}
            onClick={() => {
              close();
              onRename();
            }}
          >
            Переименовать
          </MenuItem>
          <div className="menu-sep" />
          <MenuItem
            danger
            icon={<Trash2 size={16} />}
            onClick={() => {
              close();
              ui.openDialog({
                kind: 'confirm',
                title: 'Удалить коллекцию?',
                message: `Коллекция «${collection.name}» будет удалена. Книги останутся в библиотеке.`,
                action: 'Удалить',
                onConfirm: () => {
                  library.deleteCollection(collection.id);
                  navigate('#/');
                },
              });
            }}
          >
            Удалить коллекцию
          </MenuItem>
        </div>
      )}
    </Popover>
  );
}

function AddButton() {
  const ui = useUI();
  if (!canPickFolders) {
    return (
      <button type="button" className="btn btn-primary" onClick={ui.pickFiles}>
        <Plus size={18} /> Добавить
      </button>
    );
  }
  return (
    <Popover
      label="Добавить книги"
      buttonClassName="btn btn-primary"
      button={
        <>
          <Plus size={18} />
          <span className="btn-text">Добавить</span>
        </>
      }
      align="end"
    >
      {(close) => (
        <div className="menu" role="menu">
          <MenuItem
            icon={<Upload size={16} />}
            onClick={() => {
              close();
              ui.pickFiles();
            }}
          >
            Выбрать файлы…
          </MenuItem>
          <MenuItem
            icon={<FolderPlus size={16} />}
            onClick={() => {
              close();
              ui.pickFolder();
            }}
          >
            Выбрать папку…
          </MenuItem>
          <p className="menu-hint">Или просто перетащите файлы и папки в окно</p>
        </div>
      )}
    </Popover>
  );
}

function EmptyLibrary() {
  const ui = useUI();
  return (
    <div className="dropzone">
      <div className="dropzone-icon">
        <Upload size={32} />
      </div>
      <h2>Добавьте первую аудиокнигу</h2>
      <p>
        Перетащите сюда файл или целую папку с книгой. Подходят MP3, M4B/M4A, AAC, OGG/Opus, FLAC и WAV. Главы читаются из
        M4B, из тегов MP3 и из CUE-файлов; если глав нет, главой считается каждый файл.
      </p>
      <div className="dropzone-actions">
        <button type="button" className="btn btn-primary" onClick={ui.pickFiles}>
          <Upload size={18} /> Выбрать файлы
        </button>
        {canPickFolders && (
          <button type="button" className="btn" onClick={ui.pickFolder}>
            <FolderPlus size={18} /> Выбрать папку
          </button>
        )}
      </div>
      <p className="muted small">Книги хранятся только в этом браузере и не загружаются в интернет.</p>
    </div>
  );
}
