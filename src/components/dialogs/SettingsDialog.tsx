import { HardDrive, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { formatBytes } from '../../lib/format';
import { requestPersistentStorage } from '../../lib/import/import';
import { updateSettings, useSettings } from '../../store/settings';
import { Modal } from '../Modal';

const SKIP_OPTIONS = [5, 10, 15, 20, 30, 45, 60];

const SHORTCUTS: [string, string][] = [
  ['Пробел или K', 'Пауза / продолжить'],
  ['← / →', 'Назад / вперёд'],
  ['Shift + ← / →', 'Предыдущая / следующая глава'],
  ['[ / ]', 'Медленнее / быстрее'],
  ['B', 'Закладка'],
];

interface StorageInfo {
  usage: number;
  quota: number;
  persisted: boolean;
}

async function readStorageInfo(): Promise<StorageInfo | null> {
  try {
    const [{ usage = 0, quota = 0 }, persisted] = await Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted(),
    ]);
    return { usage, quota, persisted };
  } catch {
    return null; // StorageManager is unavailable (e.g. plain http)
  }
}

function useStorageInfo() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  useEffect(() => {
    let active = true;
    void readStorageInfo().then((result) => active && setInfo(result));
    return () => {
      active = false;
    };
  }, []);
  const refresh = async () => setInfo(await readStorageInfo());
  return [info, refresh] as const;
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const [storage, refreshStorage] = useStorageInfo();
  const [persistRefused, setPersistRefused] = useState(false);
  const rewind = settings.rewindOnPause;

  return (
    <Modal title="Настройки" onClose={onClose}>
      <section className="settings-section">
        <h3>Воспроизведение</h3>
        <div className="setting">
          <div className="setting-head">
            <label htmlFor="rewind-on-pause">Перемотка назад при паузе</label>
            <output htmlFor="rewind-on-pause">{rewind ? `${rewind} с` : 'выключена'}</output>
          </div>
          <input
            id="rewind-on-pause"
            className="range"
            type="range"
            min={0}
            max={30}
            step={1}
            value={rewind}
            style={{ '--pct': `${(rewind / 30) * 100}%` } as CSSProperties}
            onChange={(e) => updateSettings({ rewindOnPause: Number(e.target.value) })}
          />
          <p className="setting-hint">
            После паузы книга отматывается немного назад, чтобы было легче вспомнить, на чём остановились. Срабатывает и
            при паузе с наушников, экрана блокировки или по таймеру сна.
          </p>
        </div>
        <div className="setting setting-row">
          <label htmlFor="skip-back">Кнопка «назад»</label>
          <select
            id="skip-back"
            className="select"
            value={settings.skipBack}
            onChange={(e) => updateSettings({ skipBack: Number(e.target.value) })}
          >
            {SKIP_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s} с
              </option>
            ))}
          </select>
        </div>
        <div className="setting setting-row">
          <label htmlFor="skip-forward">Кнопка «вперёд»</label>
          <select
            id="skip-forward"
            className="select"
            value={settings.skipForward}
            onChange={(e) => updateSettings({ skipForward: Number(e.target.value) })}
          >
            {SKIP_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s} с
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="settings-section">
        <h3>Хранилище</h3>
        <p className="setting-hint">
          Книги, прогресс и закладки хранятся только в этом браузере (IndexedDB) и доступны без интернета. В другом
          браузере или в режиме инкогнито библиотека будет пустой.
        </p>
        {storage && (
          <>
            <p className="storage-line">
              <HardDrive size={16} /> Занято {formatBytes(storage.usage)}
              {storage.quota > 0 && ` из доступных ${formatBytes(storage.quota)}`}
            </p>
            {storage.persisted ? (
              <p className="storage-line ok">
                <ShieldCheck size={16} /> Постоянное хранение включено: браузер не удалит книги при нехватке места.
              </p>
            ) : (
              <div className="storage-line">
                <span>Браузер может удалить данные, если на диске закончится место.</span>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={async () => {
                    const granted = await requestPersistentStorage();
                    setPersistRefused(!granted);
                    await refreshStorage();
                  }}
                >
                  Попросить сохранять
                </button>
              </div>
            )}
            {persistRefused && (
              <p className="setting-hint">
                Браузер отказал. Chrome обычно разрешает постоянное хранение сайтам, которые часто открывают или
                добавили в закладки либо на главный экран.
              </p>
            )}
          </>
        )}
      </section>

      <section className="settings-section">
        <h3>Горячие клавиши</h3>
        <dl className="shortcuts">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys}>
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      </section>
    </Modal>
  );
}
