import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** False while something must not be interrupted (e.g. saving files). */
  dismissible?: boolean;
}

export function Modal({ title, onClose, children, footer, wide, dismissible = true }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    // Start from the dialog itself rather than its first button (the close cross).
    if (!dialog.querySelector('[autofocus]')) innerRef.current?.focus();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={wide ? 'modal modal-wide' : 'modal'}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onMouseDown={(e) => {
        // A click on the backdrop lands on the <dialog> itself.
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
    >
      <div className="modal-inner" ref={innerRef} tabIndex={-1}>
        <header className="modal-header">
          <h2>{title}</h2>
          {dismissible && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
              <X size={20} />
            </button>
          )}
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </dialog>
  );
}
