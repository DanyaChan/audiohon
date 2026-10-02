import type { CSSProperties } from 'react';
import { cls } from '../ui/cls';

interface CoverProps {
  src?: string;
  title: string;
  author?: string;
  /** Small sizes show just the first letter instead of the title. */
  compact?: boolean;
  className?: string;
}

function hue(text: string): number {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function Cover({ src, title, author, compact, className }: CoverProps) {
  if (src) return <img className={cls('cover', className)} src={src} alt="" draggable={false} />;
  return (
    <div
      className={cls('cover', 'cover-placeholder', compact && 'compact', className)}
      style={{ '--hue': hue(title) } as CSSProperties}
      aria-hidden="true"
    >
      {compact ? (
        <span className="cover-letter">{title.trim().charAt(0).toUpperCase()}</span>
      ) : (
        <>
          <span className="cover-title">{title}</span>
          {author && <span className="cover-author">{author}</span>}
        </>
      )}
    </div>
  );
}
