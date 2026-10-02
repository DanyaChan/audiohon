import { useSyncExternalStore } from 'react';

export interface Settings {
  /** Seconds to jump back when playback is paused; 0 turns it off. */
  rewindOnPause: number;
  skipBack: number;
  skipForward: number;
}

const KEY = 'audiohon:settings';
const DEFAULTS: Settings = { rewindOnPause: 3, skipBack: 15, skipForward: 30 };

const listeners = new Set<() => void>();
let current = read();

function read(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

export const getSettings = () => current;

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage unavailable: the settings still apply to this session.
  }
  listeners.forEach((l) => l());
}

window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  current = read();
  listeners.forEach((l) => l());
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useSettings = () => useSyncExternalStore(subscribe, getSettings);
