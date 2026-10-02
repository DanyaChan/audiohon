import { Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookCollectionsDialog, CollectionBooksDialog } from './components/dialogs/CollectionDialogs';
import { ConfirmDialog } from './components/dialogs/ConfirmDialog';
import { EditBookDialog } from './components/dialogs/EditBookDialog';
import { ImportDialog } from './components/dialogs/ImportDialog';
import { SettingsDialog } from './components/dialogs/SettingsDialog';
import { LibraryView } from './components/LibraryView';
import { MiniPlayer } from './components/MiniPlayer';
import { PlayerView } from './components/PlayerView';
import { Sidebar } from './components/Sidebar';
import { Toasts, type ToastItem } from './components/Toasts';
import { formatTime } from './lib/format';
import type { SourceFile } from './lib/import/grouping';
import { fromFileList } from './lib/import/sources';
import { player, usePlayerSelector } from './player/player';
import { library, useLibrary } from './store/library';
import { useFileDrop, useShortcuts } from './ui/hooks';
import { filterHref, navigate, useRoute } from './ui/route';
import { UIContext, type Dialog, type UI } from './ui/ui';

const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.m4b,.aac,.ogg,.oga,.opus,.flac,.wav,.webm,.cue,image/*';

let toastId = 0;
let importId = 0;
let started = false;

export default function App() {
  const { ready } = useLibrary();
  const route = useRoute();
  const hasBook = usePlayerSelector((s) => s.book !== null);
  const [booted, setBooted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Files picked while an import is still running wait for their turn.
  const [imports, setImports] = useState<{ id: number; sources: SourceFile[] }[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  // Where "back" from the player leads: the library view it was opened from.
  const [libraryHref, setLibraryHref] = useState('#/');
  const currentLibraryHref = route.view === 'library' ? filterHref(route.filter) : null;
  if (currentLibraryHref && currentLibraryHref !== libraryHref) setLibraryHref(currentLibraryHref);

  const toast = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    const id = ++toastId;
    setToasts((list) => [...list.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);

  const ui = useMemo<UI>(
    () => ({
      openDialog: setDialog,
      closeDialog: () => setDialog(null),
      toast,
      pickFiles: () => filesInput.current?.click(),
      pickFolder: () => folderInput.current?.click(),
      openMenu: () => setMenuOpen(true),
    }),
    [toast],
  );

  useEffect(() => {
    library.onError = (error) => {
      console.error(error);
      const quota = error instanceof DOMException && error.name === 'QuotaExceededError';
      toast(quota ? 'Не хватает места в хранилище браузера' : 'Не удалось сохранить изменения', 'error');
    };
    if (started) return;
    started = true;
    library
      .load()
      .then(() => {
        player.restore();
        setBooted(true);
      })
      .catch((error) => {
        console.error(error);
        setFailed(true);
      });
  }, [toast]);

  // The player view needs a book; without one, show the library.
  useEffect(() => {
    if (booted && route.view === 'player' && !hasBook) navigate('#/');
  }, [booted, route, hasBook]);

  const importFiles = useCallback((sources: SourceFile[]) => {
    const id = ++importId;
    setImports((queue) => [...queue, { id, sources }]);
  }, []);
  const dragging = useFileDrop(importFiles);

  const addBookmark = useCallback(() => {
    const { book } = player.getState();
    if (!book) return;
    const bookmark = library.addBookmark(book.id, player.position());
    toast(`Закладка на ${formatTime(bookmark.position)}`);
  }, [toast]);
  useShortcuts(addBookmark);

  if (failed) {
    return (
      <div className="splash">
        <h1>Не удалось открыть библиотеку</h1>
        <p>Браузер не дал доступ к хранилищу (IndexedDB). В режиме инкогнито или при запрете cookies оно бывает недоступно.</p>
      </div>
    );
  }
  if (!ready) return <div className="splash" aria-busy="true" />;

  const collectionId = route.view === 'library' && route.filter.kind === 'collection' ? route.filter.id : undefined;
  const close = () => setDialog(null);

  return (
    <UIContext.Provider value={ui}>
      <div className="app">
        <Sidebar route={route} open={menuOpen} onClose={() => setMenuOpen(false)} />
        <div className="content">
          {route.view === 'player' ? <PlayerView backHref={libraryHref} /> : <LibraryView filter={route.filter} />}
          {route.view !== 'player' && <MiniPlayer />}
        </div>
      </div>

      <input
        ref={filesInput}
        type="file"
        multiple
        hidden
        accept={AUDIO_ACCEPT}
        onChange={(e) => {
          const sources = fromFileList(e.target.files ?? []);
          e.target.value = '';
          if (sources.length) importFiles(sources);
        }}
      />
      <input
        ref={(el) => {
          folderInput.current = el;
          el?.setAttribute('webkitdirectory', '');
        }}
        type="file"
        hidden
        onChange={(e) => {
          const sources = fromFileList(e.target.files ?? []);
          e.target.value = '';
          if (sources.length) importFiles(sources);
        }}
      />

      {imports.length > 0 && (
        <ImportDialog
          key={imports[0].id}
          sources={imports[0].sources}
          collectionId={collectionId}
          onClose={() => setImports((queue) => queue.slice(1))}
        />
      )}
      {dialog?.kind === 'settings' && <SettingsDialog onClose={close} />}
      {dialog?.kind === 'edit-book' && <EditBookDialog bookId={dialog.bookId} onClose={close} />}
      {dialog?.kind === 'book-collections' && <BookCollectionsDialog bookId={dialog.bookId} onClose={close} />}
      {dialog?.kind === 'collection-books' && <CollectionBooksDialog collectionId={dialog.collectionId} onClose={close} />}
      {dialog?.kind === 'confirm' && (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          action={dialog.action}
          onConfirm={dialog.onConfirm}
          onClose={close}
        />
      )}

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">
            <Upload size={40} />
            <p>Отпустите, чтобы добавить книги</p>
          </div>
        </div>
      )}
      <Toasts items={toasts} />
    </UIContext.Provider>
  );
}
