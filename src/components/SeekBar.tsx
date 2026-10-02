import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { formatTime } from '../lib/format';
import { clamp } from '../lib/util';
import { player } from '../player/player';

interface SeekBarProps {
  start: number;
  end: number;
  position: number;
  label: string;
}

/** Seeks within [start, end] of the book timeline; seeks once the thumb is released. */
export function SeekBar({ start, end, position, label }: SeekBarProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState<number | null>(null);

  useEffect(() => {
    const input = ref.current!;
    // `change` fires when the thumb is released (React's onChange fires on every move).
    const commit = () => {
      setDrag(null);
      void player.seek(Number(input.value));
    };
    input.addEventListener('change', commit);
    return () => input.removeEventListener('change', commit);
  }, []);

  const value = drag ?? clamp(position, start, end);
  const pct = end > start ? ((value - start) / (end - start)) * 100 : 0;

  return (
    <div className="seek">
      <input
        ref={ref}
        type="range"
        min={start}
        max={end}
        step="any"
        value={value}
        aria-label={label}
        aria-valuetext={formatTime(value - start)}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(e) => setDrag(Number(e.target.value))}
      />
      {drag !== null && (
        <div className="seek-tooltip" style={{ left: `${pct}%` }}>
          {formatTime(drag - start)}
        </div>
      )}
    </div>
  );
}
