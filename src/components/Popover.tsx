import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

interface PopoverProps {
  /** Accessible name of the trigger button. */
  label: string;
  button: ReactNode;
  buttonClassName?: string;
  align?: 'start' | 'end';
  placement?: 'below' | 'above';
  className?: string;
  children: (close: () => void) => ReactNode;
}

const GAP = 6;
const MARGIN = 8;

/**
 * A button with a floating panel (menus, speed and sleep pickers). Uses the
 * native Popover API: the panel lives in the top layer, so it is never
 * clipped by scrolling containers and closes on outside clicks and Escape.
 */
export function Popover({
  label,
  button,
  buttonClassName = 'icon-btn',
  align = 'start',
  placement = 'below',
  className = '',
  children,
}: PopoverProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const panel = panelRef.current!;
    const trigger = triggerRef.current!;

    const place = (above: boolean) => {
      const t = trigger.getBoundingClientRect();
      const s = panel.style;
      s.left = s.right = s.top = s.bottom = '';
      if (align === 'end') s.right = `${Math.max(MARGIN, innerWidth - t.right)}px`;
      else s.left = `${Math.max(MARGIN, t.left)}px`;
      if (above) s.bottom = `${innerHeight - t.top + GAP}px`;
      else s.top = `${t.bottom + GAP}px`;
    };
    // Fixed-position panels would drift away from their button: close on scroll and resize.
    const onViewportChange = (e: Event) => {
      if (e.target instanceof Node && panel.contains(e.target)) return; // scrolling inside the panel
      if (panel.matches(':popover-open')) panel.hidePopover();
    };
    const watchViewport = (on: boolean) => {
      const method = on ? 'addEventListener' : 'removeEventListener';
      window[method]('resize', onViewportChange);
      window[method]('scroll', onViewportChange, true);
    };
    const onBeforeToggle = (e: Event) => {
      const opening = (e as ToggleEvent).newState === 'open';
      if (opening) place(placement === 'above');
      watchViewport(opening);
      flushSync(() => setOpen(opening));
    };
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState !== 'open') return;
      // Flip to the other side if the panel does not fit.
      const r = panel.getBoundingClientRect();
      if (placement === 'below' && r.bottom > innerHeight - MARGIN) place(true);
      if (placement === 'above' && r.top < MARGIN) place(false);
      const fitted = panel.getBoundingClientRect();
      if (fitted.right > innerWidth - MARGIN) {
        panel.style.left = '';
        panel.style.right = `${MARGIN}px`;
      }
    };

    panel.addEventListener('beforetoggle', onBeforeToggle);
    panel.addEventListener('toggle', onToggle);
    return () => {
      panel.removeEventListener('beforetoggle', onBeforeToggle);
      panel.removeEventListener('toggle', onToggle);
      watchViewport(false);
    };
  }, [align, placement]);

  const close = () => {
    const panel = document.getElementById(id);
    if (panel?.matches(':popover-open')) panel.hidePopover();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={buttonClassName}
        popoverTarget={id}
        aria-label={label}
        title={label}
        aria-expanded={open}
      >
        {button}
      </button>
      <div ref={panelRef} id={id} popover="auto" className={`popover ${className}`}>
        {open && children(close)}
      </div>
    </>
  );
}

interface MenuItemProps {
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

export function MenuItem({ icon, children, onClick, danger }: MenuItemProps) {
  return (
    <button type="button" role="menuitem" className={danger ? 'menu-item danger' : 'menu-item'} onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  );
}
