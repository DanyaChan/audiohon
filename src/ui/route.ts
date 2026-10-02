import { useMemo, useSyncExternalStore } from 'react';

export type Filter =
  | { kind: 'all' }
  | { kind: 'listening' }
  | { kind: 'new' }
  | { kind: 'finished' }
  | { kind: 'collection'; id: string };

export type Route = { view: 'library'; filter: Filter } | { view: 'player' };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'player') return { view: 'player' };
  if (path.startsWith('c/')) return { view: 'library', filter: { kind: 'collection', id: decodeURIComponent(path.slice(2)) } };
  if (path === 'listening' || path === 'new' || path === 'finished') return { view: 'library', filter: { kind: path } };
  return { view: 'library', filter: { kind: 'all' } };
}

export function filterHref(filter: Filter): string {
  if (filter.kind === 'collection') return `#/c/${encodeURIComponent(filter.id)}`;
  return filter.kind === 'all' ? '#/' : `#/${filter.kind}`;
}

export const PLAYER_HREF = '#/player';

const subscribe = (listener: () => void) => {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return useMemo(() => parseRoute(hash), [hash]);
}

export function navigate(href: string) {
  if (location.hash !== href) location.hash = href;
}
