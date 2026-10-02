import { useEffect, useState } from 'react';
import { fromDataTransfer } from '../lib/import/sources';
import type { SourceFile } from '../lib/import/grouping';
import { player } from '../player/player';
import { getSettings } from '../store/settings';

/** Global keyboard shortcuts for the player. */
export function useShortcuts(onBookmark: () => void) {
  useEffect(() => {
    let swallowSpaceUp = false;
    // The control last pressed with a mouse or finger; null once the user navigates with Tab.
    let pointerTarget: Element | null = null;
    const onPointerDown = (e: PointerEvent) => {
      pointerTarget = e.target instanceof Element ? e.target.closest('button, a, summary') : null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') pointerTarget = null;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || !player.getState().book) return;
      if (document.querySelector('dialog[open]')) return;
      const target = e.target instanceof Element ? e.target : document.body;
      if (target.closest('textarea, select, [contenteditable]')) return;
      const input = target.closest('input');
      if (input && input.type !== 'range') return;
      if (input && e.code.startsWith('Arrow')) return; // the seek bar handles its own arrows
      // Space activates a button reached with Tab; after a mouse click it means play/pause.
      const control = target.closest('button, a, summary');
      if (e.code === 'Space' && control && control !== pointerTarget) return;

      const { skipBack, skipForward } = getSettings();
      switch (e.code) {
        case 'Space':
        case 'KeyK':
          player.toggle();
          swallowSpaceUp = e.code === 'Space';
          // Otherwise the clicked button would now show a keyboard focus ring.
          if (control instanceof HTMLElement) control.blur();
          break;
        case 'ArrowLeft':
        case 'KeyJ':
          if (e.shiftKey) player.prevChapter();
          else player.skip(-skipBack);
          break;
        case 'ArrowRight':
        case 'KeyL':
          if (e.shiftKey) player.nextChapter();
          else player.skip(skipForward);
          break;
        case 'BracketLeft':
          player.setRate(player.getState().rate - 0.05);
          break;
        case 'BracketRight':
          player.setRate(player.getState().rate + 0.05);
          break;
        case 'KeyB':
          onBookmark();
          break;
        default:
          return;
      }
      e.preventDefault();
    };

    // A focused button is activated on keyup, so that has to be cancelled too.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && swallowSpaceUp) {
        swallowSpaceUp = false;
        e.preventDefault();
      }
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [onBookmark]);
}

/** Files and folders dragged onto the window; returns whether a drag is over it. */
export function useFileDrop(onDrop: (sources: SourceFile[]) => void): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setActive(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setActive(false);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const onDropEvent = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setActive(false);
      void fromDataTransfer(e.dataTransfer!).then((sources) => {
        if (sources.length) onDrop(sources);
      });
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDropEvent);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDropEvent);
    };
  }, [onDrop]);

  return active;
}
