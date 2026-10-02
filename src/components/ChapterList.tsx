import { AudioLines } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { chapterIndexAt } from '../lib/chapters';
import { formatTime } from '../lib/format';
import { player } from '../player/player';
import type { Book } from '../types';
import { cls } from '../ui/cls';

export function ChapterList({ book, position, playing }: { book: Book; position: number; playing: boolean }) {
  const current = chapterIndexAt(book.chapters, position);
  const listRef = useRef<HTMLOListElement>(null);

  // Keep the current chapter in view, scrolling only the list itself (not the page).
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>('.chapter-row.current');
    if (!list || !item || list.scrollHeight <= list.clientHeight) return;
    const top = item.offsetTop;
    if (top < list.scrollTop || top + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 3;
    }
  }, [current]);

  if (book.chapters.length <= 1) {
    return (
      <div className="empty-small">
        <p>В этой книге нет оглавления.</p>
        <p className="muted small">
          Главы берутся из M4B/M4A, из ID3-тегов MP3 и из CUE-файла рядом с книгой. Если книга разбита на несколько
          файлов, главой становится каждый файл.
        </p>
      </div>
    );
  }

  return (
    <ol className="chapter-list" ref={listRef}>
      {book.chapters.map((chapter, i) => {
        const end = book.chapters[i + 1]?.start ?? book.duration;
        const isCurrent = i === current;
        return (
          <li key={i}>
            <button
              type="button"
              className={cls('chapter-row', isCurrent && 'current', i < current && 'done')}
              onClick={() => player.playFrom(chapter.start)}
              aria-current={isCurrent ? 'true' : undefined}
            >
              <span className="chapter-index">{isCurrent && playing ? <AudioLines size={16} /> : i + 1}</span>
              <span className="chapter-title">{chapter.title}</span>
              <span className="chapter-duration">{formatTime(end - chapter.start)}</span>
              {isCurrent && (
                <span
                  className="chapter-progress"
                  style={{ width: `${Math.min(100, ((position - chapter.start) / (end - chapter.start)) * 100)}%` }}
                />
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
