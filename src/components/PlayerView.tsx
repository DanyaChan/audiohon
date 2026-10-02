import { Bookmark, BookmarkPlus, ChevronLeft, ListOrdered, SkipBack, SkipForward, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { chapterAt } from '../lib/chapters';
import { formatDuration, formatTime } from '../lib/format';
import { player, usePlayer } from '../player/player';
import { library, statusOf, useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { cls } from '../ui/cls';
import { useUI } from '../ui/ui';
import { BookmarkList } from './BookmarkList';
import { BookMenu } from './BookCard';
import { ChapterList } from './ChapterList';
import { PlayButton, SkipButton, SleepControl, SpeedControl } from './controls';
import { Cover } from './Cover';
import { SeekBar } from './SeekBar';

export function PlayerView({ backHref }: { backHref: string }) {
  const { book, playing, loading, position, rate, error, sleep } = usePlayer();
  const { covers, bookmarks, progress } = useLibrary();
  const settings = useSettings();
  const ui = useUI();
  const [tab, setTab] = useState<'chapters' | 'bookmarks'>('chapters');
  const [editingBookmark, setEditingBookmark] = useState<string | null>(null);
  if (!book) return null;

  const chapter = chapterAt(book, position);
  const marks = bookmarks[book.id] ?? [];
  const bookPct = Math.min(100, (position / book.duration) * 100 || 0);
  const hasChapters = book.chapters.length > 1;

  const addBookmark = () => {
    const bookmark = library.addBookmark(book.id, player.position());
    setTab('bookmarks');
    setEditingBookmark(bookmark.id);
  };

  return (
    <div className="view player-view">
      <header className="toolbar">
        <a className="back-link" href={backHref}>
          <ChevronLeft size={20} />
          <span>Библиотека</span>
        </a>
        <div className="toolbar-actions">
          <BookMenu book={book} status={statusOf(progress[book.id])} />
        </div>
      </header>

      {error && (
        <div className="banner" role="alert">
          <TriangleAlert size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="player-layout">
        <section className="player-main" aria-label="Плеер">
          <Cover src={covers[book.id]} title={book.title} author={book.author} className="player-cover" />
          <div className="player-heading">
            <h1 className="player-title">{book.title}</h1>
            {book.author && <p className="player-author">{book.author}</p>}
          </div>

          <div className="player-chapter">
            <span className="player-chapter-title">{chapter.title}</span>
            {hasChapters && (
              <span className="player-chapter-count">
                {chapter.index + 1} из {book.chapters.length}
              </span>
            )}
          </div>
          <SeekBar start={chapter.start} end={chapter.end} position={position} label={hasChapters ? 'Позиция в главе' : 'Позиция в книге'} />
          <div className="times">
            <span>{formatTime(position - chapter.start)}</span>
            <span title="Осталось с учётом скорости">−{formatTime(Math.max(0, chapter.end - position) / rate)}</span>
          </div>

          <div className="transport">
            <button
              type="button"
              className="icon-btn transport-btn"
              onClick={() => player.prevChapter()}
              aria-label="Предыдущая глава"
              title="Предыдущая глава (Shift + ←)"
            >
              <SkipBack size={22} fill="currentColor" />
            </button>
            <SkipButton seconds={settings.skipBack} back large />
            <PlayButton playing={playing} loading={loading} large />
            <SkipButton seconds={settings.skipForward} large />
            <button
              type="button"
              className="icon-btn transport-btn"
              onClick={() => player.nextChapter()}
              disabled={chapter.index >= book.chapters.length - 1}
              aria-label="Следующая глава"
              title="Следующая глава (Shift + →)"
            >
              <SkipForward size={22} fill="currentColor" />
            </button>
          </div>

          <div className="player-extras">
            <SpeedControl rate={rate} />
            <SleepControl sleep={sleep} />
            <button type="button" className="extra-btn" onClick={addBookmark} title="Добавить закладку (B)">
              <BookmarkPlus size={18} />
              <span>Закладка</span>
            </button>
          </div>

          <div className="book-progress">
            <div className="progress">
              <span style={{ width: `${bookPct}%` }} />
            </div>
            <div className="book-progress-text">
              <span>Прослушано {Math.floor(bookPct)}%</span>
              <span>осталось {formatDuration(Math.max(0, book.duration - position) / rate)}</span>
            </div>
          </div>
          {settings.rewindOnPause > 0 && (
            <p className="rewind-hint">
              При паузе — назад на {settings.rewindOnPause} с ·{' '}
              <button type="button" className="link-btn" onClick={() => ui.openDialog({ kind: 'settings' })}>
                настроить
              </button>
            </p>
          )}
        </section>

        <section className="player-side" aria-label="Содержание и закладки">
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'chapters'}
              className={cls('tab', tab === 'chapters' && 'active')}
              onClick={() => setTab('chapters')}
            >
              <ListOrdered size={16} />
              Содержание
              {hasChapters && <span className="tab-count">{book.chapters.length}</span>}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'bookmarks'}
              className={cls('tab', tab === 'bookmarks' && 'active')}
              onClick={() => setTab('bookmarks')}
            >
              <Bookmark size={16} />
              Закладки
              {marks.length > 0 && <span className="tab-count">{marks.length}</span>}
            </button>
          </div>
          <div className="tab-panel" role="tabpanel">
            {tab === 'chapters' ? (
              <ChapterList book={book} position={position} playing={playing} />
            ) : (
              <BookmarkList
                book={book}
                bookmarks={marks}
                editingId={editingBookmark}
                onEditDone={() => setEditingBookmark(null)}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
