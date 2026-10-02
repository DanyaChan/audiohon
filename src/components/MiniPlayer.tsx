import { chapterAt } from '../lib/chapters';
import { formatTime } from '../lib/format';
import { usePlayer } from '../player/player';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { PLAYER_HREF } from '../ui/route';
import { PlayButton, SkipButton } from './controls';
import { Cover } from './Cover';

export function MiniPlayer() {
  const { book, playing, loading, position, error } = usePlayer();
  const { covers } = useLibrary();
  const settings = useSettings();
  if (!book) return null;

  const chapter = chapterAt(book, position);
  const span = chapter.end - chapter.start;
  const pct = span > 0 ? Math.min(100, ((position - chapter.start) / span) * 100) : 0;

  return (
    <div className="mini-player">
      <div className="mini-progress">
        <span style={{ width: `${pct}%` }} />
      </div>
      <a className="mini-info" href={PLAYER_HREF} title="Открыть плеер">
        <Cover src={covers[book.id]} title={book.title} compact className="mini-cover" />
        <span className="mini-text">
          <span className="mini-title">{book.title}</span>
          <span className={error ? 'mini-sub error' : 'mini-sub'}>{error ?? chapter.title}</span>
        </span>
      </a>
      <div className="mini-controls">
        <SkipButton seconds={settings.skipBack} back />
        <PlayButton playing={playing} loading={loading} />
        <SkipButton seconds={settings.skipForward} />
      </div>
      <div className="mini-time">
        {formatTime(position - chapter.start)} / {formatTime(span)}
      </div>
    </div>
  );
}
