import { player } from '../player/player';
import type { Book } from '../types';
import { navigate, PLAYER_HREF } from './route';

/** Makes the book current (without starting playback) and shows the player. */
export function openBook(book: Book) {
  void player.open(book);
  navigate(PLAYER_HREF);
}
