import { CircleCheck, Ellipsis, FolderHeart, FolderMinus, Pause, Pencil, Play, RotateCcw, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { formatDuration } from '../lib/format';
import { player } from '../player/player';
import { library, statusOf, type Status } from '../store/library';
import type { Book, Collection, Progress } from '../types';
import { cls } from '../ui/cls';
import { openBook } from '../ui/actions';
import { BOOK_DRAG_TYPE, useUI } from '../ui/ui';
import { Cover } from './Cover';
import { MenuItem, Popover } from './Popover';

interface BookCardProps {
  book: Book;
  progress: Progress;
  cover?: string;
  current: boolean;
  playing: boolean;
  /** The collection being viewed, if any. */
  collection?: Collection;
}

function statusText(book: Book, progress: Progress, status: Status): string {
  if (status === 'finished') return 'Прослушана';
  if (status === 'new') return formatDuration(book.duration);
  const pct = Math.floor((progress.position / book.duration) * 100);
  return `${pct}% · осталось ${formatDuration((book.duration - progress.position) / progress.rate)}`;
}

export const BookCard = memo(function BookCard({ book, progress, cover, current, playing, collection }: BookCardProps) {
  const status = statusOf(progress);
  const pct = status === 'finished' ? 100 : Math.min(100, (progress.position / book.duration) * 100 || 0);

  return (
    <article
      className={cls('book-card', current && 'current')}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(BOOK_DRAG_TYPE, book.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <div className="card-cover">
        <button type="button" className="card-cover-btn" onClick={() => openBook(book)} aria-label={`Открыть «${book.title}»`}>
          <Cover src={cover} title={book.title} author={book.author} />
        </button>
        <button
          type="button"
          className="card-play"
          onClick={() => (current ? player.toggle() : void player.open(book, true))}
          aria-label={current && playing ? 'Пауза' : `Слушать «${book.title}»`}
        >
          {current && playing ? <Pause size={20} fill="currentColor" strokeWidth={0} /> : <Play size={20} fill="currentColor" strokeWidth={0} />}
        </button>
        {status === 'finished' && (
          <span className="card-badge" title="Прослушана">
            <CircleCheck size={16} />
          </span>
        )}
        {status === 'listening' && (
          <div className="card-progress">
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="card-body">
        <button type="button" className="card-text" onClick={() => openBook(book)} tabIndex={-1}>
          <span className="card-title" title={book.title}>
            {book.title}
          </span>
          <span className="card-author">{book.author || 'Автор не указан'}</span>
          <span className="card-status">{statusText(book, progress, status)}</span>
        </button>
        <BookMenu book={book} status={status} collection={collection} />
      </div>
    </article>
  );
});

interface BookMenuProps {
  book: Book;
  status: Status;
  collection?: Collection;
  onDeleted?: () => void;
}

export function BookMenu({ book, status, collection, onDeleted }: BookMenuProps) {
  const ui = useUI();

  const setFinished = (finished: boolean) => {
    const position = finished ? book.duration : 0;
    if (player.getState().book?.id === book.id) player.stopAt(position);
    library.saveProgress(book.id, { finished, position });
  };

  const remove = () =>
    ui.openDialog({
      kind: 'confirm',
      title: 'Удалить книгу?',
      message: `«${book.title}» будет удалена из библиотеки вместе с прогрессом и закладками, а её файлы — из хранилища браузера.`,
      action: 'Удалить',
      onConfirm: async () => {
        await library.deleteBook(book.id);
        onDeleted?.();
        ui.toast('Книга удалена');
      },
    });

  return (
    <Popover label="Действия с книгой" button={<Ellipsis size={18} />} align="end">
      {(close) => {
        const run = (action: () => void) => () => {
          close();
          action();
        };
        return (
          <div className="menu" role="menu">
            <MenuItem icon={<FolderHeart size={16} />} onClick={run(() => ui.openDialog({ kind: 'book-collections', bookId: book.id }))}>
              Коллекции…
            </MenuItem>
            {collection && (
              <MenuItem
                icon={<FolderMinus size={16} />}
                onClick={run(() => library.setInCollection(book.id, collection.id, false))}
              >
                Убрать из «{collection.name}»
              </MenuItem>
            )}
            <MenuItem icon={<Pencil size={16} />} onClick={run(() => ui.openDialog({ kind: 'edit-book', bookId: book.id }))}>
              Изменить…
            </MenuItem>
            {status !== 'finished' && (
              <MenuItem icon={<CircleCheck size={16} />} onClick={run(() => setFinished(true))}>
                Отметить прослушанной
              </MenuItem>
            )}
            {status !== 'new' && (
              <MenuItem icon={<RotateCcw size={16} />} onClick={run(() => setFinished(false))}>
                Начать сначала
              </MenuItem>
            )}
            <div className="menu-sep" />
            <MenuItem danger icon={<Trash2 size={16} />} onClick={run(remove)}>
              Удалить…
            </MenuItem>
          </div>
        );
      }}
    </Popover>
  );
}
