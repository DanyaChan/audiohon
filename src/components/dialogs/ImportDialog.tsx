import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatBytes, formatDuration, plural } from '../../lib/format';
import { buildDrafts, dirname, suggestMode, type Analysis, type Draft, type GroupMode, type SourceFile } from '../../lib/import/grouping';
import { analyze, requestPersistentStorage, saveDraft } from '../../lib/import/import';
import { sum, unique } from '../../lib/util';
import { library, useLibrary } from '../../store/library';
import { cls } from '../../ui/cls';
import { useObjectUrl } from '../../ui/useObjectUrl';
import { useUI } from '../../ui/ui';
import { Cover } from '../Cover';
import { Modal } from '../Modal';

type Stage =
  | { name: 'analyzing'; done: number; total: number }
  | { name: 'review' }
  | { name: 'saving'; bytes: number; total: number; title: string }
  | { name: 'failed'; message: string };

const MODES: [GroupMode, string][] = [
  ['single', 'Одна книга'],
  ['folders', 'Книга на папку'],
  ['files', 'Книга на файл'],
];

const isQuotaError = (e: unknown) => e instanceof DOMException && e.name === 'QuotaExceededError';

interface ImportDialogProps {
  sources: SourceFile[];
  /** Add the new books to this collection by default. */
  collectionId?: string;
  onClose: () => void;
}

export function ImportDialog({ sources, collectionId, onClose }: ImportDialogProps) {
  const ui = useUI();
  const { collections } = useLibrary();
  const [stage, setStage] = useState<Stage>({ name: 'analyzing', done: 0, total: 0 });
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mode, setMode] = useState<GroupMode>('single');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [target, setTarget] = useState(collectionId ?? '');
  const [freeSpace, setFreeSpace] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    analyze(sources, (done, total) => !signal.aborted && setStage({ name: 'analyzing', done, total }), signal)
      .then((result) => {
        if (signal.aborted) return;
        const suggested = suggestMode(result);
        setAnalysis(result);
        setMode(suggested);
        setDrafts(buildDrafts(result, suggested));
        setStage({ name: 'review' });
      })
      .catch((error) => {
        if (!signal.aborted) setStage({ name: 'failed', message: `Не удалось прочитать файлы: ${error}` });
      });
    navigator.storage
      ?.estimate?.()
      .then(({ quota, usage }) => quota !== undefined && setFreeSpace(quota - (usage ?? 0)))
      .catch(() => undefined);
    return () => controller.abort();
  }, [sources]);

  const totalSize = sum(drafts.map((d) => d.size));
  const saving = stage.name === 'saving';

  const changeMode = (next: GroupMode) => {
    if (!analysis) return;
    setMode(next);
    setDrafts(buildDrafts(analysis, next));
  };

  const updateDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const save = async () => {
    // Ask the browser not to evict the library when the disk fills up (Firefox shows a prompt).
    void requestPersistentStorage();
    let saved = 0;
    let base = 0;
    try {
      for (const draft of drafts) {
        setStage({ name: 'saving', bytes: base, total: totalSize, title: draft.title });
        const book = await saveDraft(draft, (bytes) =>
          setStage({ name: 'saving', bytes: base + bytes, total: totalSize, title: draft.title }),
        );
        base += draft.size;
        saved++;
        if (target) library.setInCollection(book.id, target, true);
      }
      ui.toast(
        drafts.length === 1
          ? `Книга «${drafts[0].title.trim() || 'Без названия'}» добавлена`
          : `Добавлено ${drafts.length} ${plural(drafts.length, ['книга', 'книги', 'книг'])}`,
      );
      onClose();
    } catch (error) {
      console.error(error);
      const reason = isQuotaError(error)
        ? 'В хранилище браузера не хватило места.'
        : `Не удалось сохранить файлы (${error instanceof Error ? error.message : String(error)}).`;
      const done = saved ? ` Успешно добавлено книг: ${saved}.` : '';
      setStage({ name: 'failed', message: reason + done });
    }
  };

  const audioCount = analysis?.audio.length ?? 0;
  const folderCount = unique(analysis?.audio.map((f) => dirname(f.source.path) || '.') ?? []).length;

  let body;
  let footer;
  if (stage.name === 'analyzing') {
    body = (
      <div className="import-status">
        <LoaderCircle size={28} className="spin" />
        <p>
          Читаю файлы{stage.total > 0 && `: ${stage.done} из ${stage.total}`}…
        </p>
        {stage.total > 0 && <Progress value={stage.done / stage.total} />}
      </div>
    );
  } else if (stage.name === 'failed') {
    body = (
      <div className="import-status">
        <TriangleAlert size={28} />
        <p>{stage.message}</p>
      </div>
    );
    footer = (
      <button type="button" className="btn" onClick={onClose}>
        Закрыть
      </button>
    );
  } else if (stage.name === 'saving') {
    body = (
      <div className="import-status">
        <LoaderCircle size={28} className="spin" />
        <p>Сохраняю «{stage.title}» в хранилище браузера…</p>
        <Progress value={stage.total ? stage.bytes / stage.total : 0} />
        <p className="muted small">
          {formatBytes(stage.bytes)} из {formatBytes(stage.total)}
        </p>
      </div>
    );
  } else if (!audioCount) {
    body = (
      <div className="import-status">
        <TriangleAlert size={28} />
        <p>Среди выбранных файлов нет аудио, которое может воспроизвести этот браузер.</p>
        {analysis && analysis.skipped.length > 0 && <SkippedList paths={analysis.skipped} />}
      </div>
    );
    footer = (
      <button type="button" className="btn" onClick={onClose}>
        Закрыть
      </button>
    );
  } else {
    body = (
      <>
        <p className="import-summary">
          {audioCount} {plural(audioCount, ['аудиофайл', 'аудиофайла', 'аудиофайлов'])} ·{' '}
          {formatDuration(sum(drafts.map((d) => d.duration)))} · {formatBytes(totalSize)}
        </p>
        {analysis && analysis.skipped.length > 0 && <SkippedList paths={analysis.skipped} />}
        {audioCount > 1 && (
          <div className="segmented" role="radiogroup" aria-label="Как разбить файлы на книги">
            {MODES.filter(([m]) => m !== 'folders' || folderCount > 1).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className={cls('segment', mode === m && 'active')}
                onClick={() => changeMode(m)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="drafts">
          {drafts.map((d) => (
            <DraftRow key={d.key} draft={d} onChange={(patch) => updateDraft(d.key, patch)} />
          ))}
        </div>
        {collections.length > 0 && (
          <label className="field field-inline">
            <span>Коллекция</span>
            <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Не добавлять</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {freeSpace !== null && totalSize > freeSpace && (
          <p className="warning">
            <TriangleAlert size={16} /> Может не хватить места: нужно {formatBytes(totalSize)}, браузер разрешает ещё около{' '}
            {formatBytes(Math.max(0, freeSpace))}.
          </p>
        )}
      </>
    );
    footer = (
      <>
        <button type="button" className="btn" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void save()}>
          {drafts.length === 1 ? 'Добавить книгу' : `Добавить ${drafts.length} ${plural(drafts.length, ['книгу', 'книги', 'книг'])}`}
        </button>
      </>
    );
  }

  return (
    <Modal title="Добавление книг" onClose={onClose} footer={footer} wide dismissible={!saving}>
      {body}
    </Modal>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <div className="progress progress-lg" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <span style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  );
}

function SkippedList({ paths }: { paths: string[] }) {
  return (
    <details className="skipped">
      <summary>
        Пропущено {paths.length} {plural(paths.length, ['файл', 'файла', 'файлов'])}: браузер не умеет их воспроизводить
      </summary>
      <ul>
        {paths.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </details>
  );
}

function DraftRow({ draft, onChange }: { draft: Draft; onChange: (patch: Partial<Draft>) => void }) {
  const cover = useObjectUrl(draft.cover);
  const files = draft.files.length;
  const chapters = draft.chapters.length;
  return (
    <div className="draft">
      <Cover src={cover} title={draft.title} author={draft.author} className="draft-cover" />
      <div className="draft-fields">
        <label className="field">
          <span>Название</span>
          <input className="input" value={draft.title} onChange={(e) => onChange({ title: e.target.value })} />
        </label>
        <label className="field">
          <span>Автор</span>
          <input
            className="input"
            value={draft.author}
            placeholder="Не указан"
            onChange={(e) => onChange({ author: e.target.value })}
          />
        </label>
        <p className="draft-meta">
          {files} {plural(files, ['файл', 'файла', 'файлов'])} · {formatDuration(draft.duration)} · {chapters}{' '}
          {plural(chapters, ['глава', 'главы', 'глав'])} · {formatBytes(draft.size)}
        </p>
      </div>
    </div>
  );
}
