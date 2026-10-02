import { Bookmark as BookmarkIcon, Check, Pencil, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { chapterAt } from '../lib/chapters';
import { formatTime } from '../lib/format';
import { player } from '../player/player';
import { library } from '../store/library';
import type { Book, Bookmark } from '../types';

interface BookmarkListProps {
  book: Book;
  bookmarks: Bookmark[];
  /** A just-created bookmark opens with its note field focused. */
  editingId: string | null;
  onEditDone: () => void;
}

export function BookmarkList({ book, bookmarks, editingId, onEditDone }: BookmarkListProps) {
  if (!bookmarks.length) {
    return (
      <div className="empty-small">
        <BookmarkIcon size={28} strokeWidth={1.5} />
        <p>Закладок пока нет</p>
        <p className="muted small">Нажмите «Закладка» или клавишу B, чтобы запомнить текущее место.</p>
      </div>
    );
  }
  return (
    <ul className="bookmark-list">
      {bookmarks.map((b) => (
        <BookmarkRow key={b.id} book={book} bookmark={b} startEditing={b.id === editingId} onEditDone={onEditDone} />
      ))}
    </ul>
  );
}

interface BookmarkRowProps {
  book: Book;
  bookmark: Bookmark;
  startEditing: boolean;
  onEditDone: () => void;
}

function BookmarkRow({ book, bookmark, startEditing, onEditDone }: BookmarkRowProps) {
  const [editing, setEditing] = useState(startEditing);
  const [note, setNote] = useState(bookmark.note);
  const closed = useRef(false);
  const chapter = chapterAt(book, bookmark.position);

  const finish = (save: boolean) => {
    if (closed.current) return;
    closed.current = true;
    if (save) library.updateBookmark(bookmark, note.trim());
    else setNote(bookmark.note);
    setEditing(false);
    onEditDone();
  };

  return (
    <li className="bookmark-row">
      <button type="button" className="bookmark-jump" onClick={() => player.playFrom(bookmark.position)}>
        <span className="bookmark-time">{formatTime(bookmark.position)}</span>
        <span className="bookmark-text">
          <span className="bookmark-chapter">{chapter.title}</span>
          {!editing && bookmark.note && <span className="bookmark-note">{bookmark.note}</span>}
        </span>
      </button>
      {editing ? (
        <form
          className="bookmark-edit"
          onSubmit={(e) => {
            e.preventDefault();
            finish(true);
          }}
        >
          <input
            className="input"
            autoFocus
            value={note}
            placeholder="Заметка к закладке"
            aria-label="Заметка к закладке"
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => finish(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                finish(false);
              }
            }}
          />
          <button type="submit" className="icon-btn small" aria-label="Сохранить заметку">
            <Check size={16} />
          </button>
        </form>
      ) : (
        <div className="bookmark-actions">
          <button
            type="button"
            className="icon-btn small"
            onClick={() => {
              closed.current = false;
              setNote(bookmark.note);
              setEditing(true);
            }}
            aria-label="Изменить заметку"
            title="Изменить заметку"
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            className="icon-btn small"
            onClick={() => library.removeBookmark(bookmark)}
            aria-label="Удалить закладку"
            title="Удалить закладку"
          >
            <Trash2 size={16} />
          </button>
        </div>
      )}
    </li>
  );
}
