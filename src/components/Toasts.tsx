import { useEffect, useRef } from 'react';
import { cls } from '../ui/cls';

export interface ToastItem {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

/** Rendered as a manual popover so that toasts show above open modal dialogs too. */
export function Toasts({ items }: { items: ToastItem[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current!;
    if (el.matches(':popover-open')) el.hidePopover();
    if (items.length) el.showPopover(); // re-show to stay on top of a dialog opened since
  }, [items]);

  return (
    <div ref={ref} popover="manual" className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={cls('toast', t.kind === 'error' && 'toast-error')} role={t.kind === 'error' ? 'alert' : 'status'}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
