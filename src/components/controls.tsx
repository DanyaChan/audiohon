import { Gauge, LoaderCircle, Minus, Moon, Pause, Play, Plus, RotateCcw, RotateCw, TimerOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatRate, formatTime } from '../lib/format';
import { player, type SleepTimer } from '../player/player';
import { cls } from '../ui/cls';
import { MenuItem, Popover } from './Popover';

export function PlayButton({ playing, loading, large }: { playing: boolean; loading: boolean; large?: boolean }) {
  const size = large ? 30 : 20;
  return (
    <button
      type="button"
      className={cls('play-btn', large && 'large')}
      onClick={() => player.toggle()}
      aria-label={playing ? 'Пауза' : 'Слушать'}
      title={playing ? 'Пауза (пробел)' : 'Слушать (пробел)'}
    >
      {playing && loading ? (
        <LoaderCircle size={size} className="spin" />
      ) : playing ? (
        <Pause size={size} fill="currentColor" strokeWidth={0} />
      ) : (
        <Play size={size} fill="currentColor" strokeWidth={0} className="play-icon" />
      )}
    </button>
  );
}

export function SkipButton({ seconds, back, large }: { seconds: number; back?: boolean; large?: boolean }) {
  const Icon = back ? RotateCcw : RotateCw;
  const label = `${back ? 'Назад' : 'Вперёд'} на ${seconds} с`;
  return (
    <button
      type="button"
      className={cls('skip-btn', large && 'large')}
      onClick={() => player.skip(back ? -seconds : seconds)}
      aria-label={label}
      title={`${label} (${back ? '←' : '→'})`}
    >
      <Icon size={large ? 34 : 26} strokeWidth={1.6} />
      <span className="skip-label">{seconds}</span>
    </button>
  );
}

const SPEEDS = [0.75, 1, 1.1, 1.2, 1.25, 1.3, 1.5, 1.75, 2, 2.5, 3];

export function SpeedControl({ rate }: { rate: number }) {
  return (
    <Popover
      label="Скорость воспроизведения"
      buttonClassName={cls('extra-btn', rate !== 1 && 'active')}
      button={
        <>
          <Gauge size={18} />
          <span>{formatRate(rate)}</span>
        </>
      }
      placement="above"
    >
      {() => (
        <div className="speed-panel">
          <div className="speed-stepper">
            <button type="button" className="icon-btn" onClick={() => player.setRate(rate - 0.05)} aria-label="Медленнее">
              <Minus size={18} />
            </button>
            <span className="speed-value">{formatRate(rate)}</span>
            <button type="button" className="icon-btn" onClick={() => player.setRate(rate + 0.05)} aria-label="Быстрее">
              <Plus size={18} />
            </button>
          </div>
          <div className="speed-grid">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={cls('chip', s === rate && 'active')}
                onClick={() => player.setRate(s)}
              >
                {formatRate(s)}
              </button>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}

const SLEEP_MINUTES = [5, 10, 15, 30, 45, 60, 90];

/** Time left until `endsAt`; keyed by `endsAt`, so a new timer starts from a fresh clock. */
function Countdown({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return formatTime(Math.max(0, endsAt - now) / 1000);
}

export function SleepControl({ sleep }: { sleep: SleepTimer }) {
  const label =
    sleep.kind === 'timer' ? (
      <Countdown key={sleep.endsAt} endsAt={sleep.endsAt} />
    ) : sleep.kind === 'chapter' ? (
      'До конца главы'
    ) : (
      'Таймер сна'
    );
  return (
    <Popover
      label="Таймер сна"
      buttonClassName={cls('extra-btn', sleep.kind !== 'off' && 'active')}
      button={
        <>
          <Moon size={18} />
          <span>{label}</span>
        </>
      }
      placement="above"
    >
      {(close) => (
        <div className="menu" role="menu">
          <div className="menu-title">Остановить через</div>
          {SLEEP_MINUTES.map((m) => (
            <MenuItem
              key={m}
              onClick={() => {
                player.setSleep(m);
                close();
              }}
            >
              {m < 60 ? `${m} мин` : `${(m / 60).toLocaleString('ru')} ч`}
            </MenuItem>
          ))}
          <MenuItem
            onClick={() => {
              player.setSleep('chapter');
              close();
            }}
          >
            В конце главы
          </MenuItem>
          {sleep.kind !== 'off' && (
            <>
              <div className="menu-sep" />
              <MenuItem
                icon={<TimerOff size={16} />}
                onClick={() => {
                  player.setSleep('off');
                  close();
                }}
              >
                Выключить таймер
              </MenuItem>
            </>
          )}
        </div>
      )}
    </Popover>
  );
}
