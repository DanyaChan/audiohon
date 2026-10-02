import { createContext, useContext } from 'react';

export type Dialog =
  | { kind: 'settings' }
  | { kind: 'edit-book'; bookId: string }
  | { kind: 'book-collections'; bookId: string }
  | { kind: 'collection-books'; collectionId: string }
  | { kind: 'confirm'; title: string; message: string; action: string; onConfirm: () => unknown };

export interface UI {
  openDialog: (dialog: Dialog) => void;
  closeDialog: () => void;
  toast: (text: string, kind?: 'info' | 'error') => void;
  pickFiles: () => void;
  pickFolder: () => void;
  /** Opens the sidebar on narrow screens. */
  openMenu: () => void;
}

export const UIContext = createContext<UI | null>(null);

export function useUI(): UI {
  const ui = useContext(UIContext);
  if (!ui) throw new Error('useUI must be used inside UIContext');
  return ui;
}

/** Drag-and-drop type for moving books onto collections. */
export const BOOK_DRAG_TYPE = 'application/x-audiohon-book';
