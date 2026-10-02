import { ImagePlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatBytes, formatDuration, plural } from '../../lib/format';
import { makeThumbnail } from '../../lib/import/import';
import { sum } from '../../lib/util';
import { library, useLibrary } from '../../store/library';
import { useObjectUrl } from '../../ui/useObjectUrl';
import { useUI } from '../../ui/ui';
import { Cover } from '../Cover';
import { Modal } from '../Modal';

export function EditBookDialog({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const { books, covers } = useLibrary();
  const ui = useUI();
  const book = books.find((b) => b.id === bookId);
  const [title, setTitle] = useState(book?.title ?? '');
  const [author, setAuthor] = useState(book?.author ?? '');
  /** `undefined`: keep the current cover, `null`: remove it. */
  const [cover, setCover] = useState<Blob | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const preview = useObjectUrl(cover);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!book) return null;

  const shownCover = cover === undefined ? covers[book.id] : preview;

  const save = async () => {
    setSaving(true);
    try {
      let image: Blob | null | undefined = cover;
      if (cover) {
        image = await makeThumbnail(cover);
        if (!image) {
          ui.toast('Не удалось открыть это изображение', 'error');
          setSaving(false);
          return;
        }
      }
      await library.updateBook(book.id, { title: title.trim() || book.title, author: author.trim() }, image);
      onClose();
    } catch (error) {
      console.error(error);
      ui.toast('Не удалось сохранить изменения', 'error');
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Книга"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" form="edit-book" className="btn btn-primary" disabled={saving}>
            Сохранить
          </button>
        </>
      }
    >
      <form
        id="edit-book"
        className="edit-book"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="edit-cover">
          <Cover src={shownCover} title={title || book.title} author={author} />
          <div className="edit-cover-actions">
            <button type="button" className="btn btn-small" onClick={() => fileRef.current?.click()}>
              <ImagePlus size={16} /> Обложка
            </button>
            {shownCover && (
              <button type="button" className="btn btn-small btn-ghost" onClick={() => setCover(null)}>
                Убрать
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setCover(file);
              e.target.value = '';
            }}
          />
        </div>
        <div className="edit-fields">
          <label className="field">
            <span>Название</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="field">
            <span>Автор</span>
            <input className="input" value={author} placeholder="Не указан" onChange={(e) => setAuthor(e.target.value)} />
          </label>
          <p className="muted small">
            {book.tracks.length} {plural(book.tracks.length, ['файл', 'файла', 'файлов'])} · {formatDuration(book.duration)} ·{' '}
            {book.chapters.length} {plural(book.chapters.length, ['глава', 'главы', 'глав'])} ·{' '}
            {formatBytes(sum(book.tracks.map((t) => t.size)))}
          </p>
        </div>
      </form>
    </Modal>
  );
}
