import { useSyncExternalStore } from 'react';
import { chapterAt, chapterIndexAt, trackOffsets } from '../lib/chapters';
import { getFile } from '../lib/db';
import { clamp } from '../lib/util';
import { library } from '../store/library';
import { getSettings } from '../store/settings';
import type { Book, Progress } from '../types';

export type SleepTimer = { kind: 'off' } | { kind: 'timer'; endsAt: number } | { kind: 'chapter' };

export interface PlayerState {
  book: Book | null;
  /** True while playing or about to play (e.g. while switching to the next file). */
  playing: boolean;
  /** Seconds on the book timeline. */
  position: number;
  rate: number;
  loading: boolean;
  error: string | null;
  sleep: SleepTimer;
}

const SLEEP_OFF: SleepTimer = { kind: 'off' };
const SAVE_INTERVAL = 5000;
const LAST_BOOK_KEY = 'audiohon:lastBook';

/** Resolves when the element can seek in the new source (true) or failed to load it (false). */
function metadataLoaded(audio: HTMLAudioElement): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (event: Event) => {
      audio.removeEventListener('loadedmetadata', done);
      audio.removeEventListener('error', done);
      resolve(event.type === 'loadedmetadata');
    };
    audio.addEventListener('loadedmetadata', done);
    audio.addEventListener('error', done);
  });
}

/**
 * Plays a book as one continuous timeline, even when it is split into many files.
 * A single <audio> element is reused for every file.
 */
class Player {
  private audio = new Audio();
  private state: PlayerState = {
    book: null,
    playing: false,
    position: 0,
    rate: 1,
    loading: false,
    error: null,
    sleep: SLEEP_OFF,
  };
  private listeners = new Set<() => void>();
  private offsets: number[] = [];
  /** Index of the track loaded into the audio element, -1 if none. */
  private track = -1;
  private objectUrl: string | null = null;
  /** Bumped by every load, so that superseded async work can bail out. */
  private loadId = 0;
  /** Start playing as soon as the pending load completes. */
  private playAfterLoad = false;
  /** The next `pause` event is the echo of our own pause() call. */
  private ownPause = false;
  private chapterIndex = -1;
  /** The position changed since the last save. Idle tabs must not overwrite newer progress. */
  private dirty = false;
  private lastSave = 0;
  private saveTimer = 0;
  private sleepTimer = 0;
  private sleepChapterEnd = Infinity;
  /** Only one tab plays at a time: starting playback pauses the others. */
  private channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('audiohon-player') : null;

  constructor() {
    const a = this.audio;
    a.preload = 'auto';
    a.addEventListener('play', this.onPlay);
    a.addEventListener('pause', this.onPause);
    a.addEventListener('ended', this.onEnded);
    a.addEventListener('timeupdate', this.onTimeUpdate);
    a.addEventListener('error', this.onError);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
    window.addEventListener('pagehide', () => this.flush());
    library.subscribe(this.onLibraryChange);
    library.onExternalProgress = this.onExternalProgress;
    if (this.channel) this.channel.onmessage = (e) => e.data === 'play' && this.pause();
    this.setupMediaSession();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  private set(patch: Partial<PlayerState>) {
    const keys = Object.keys(patch) as (keyof PlayerState)[];
    if (keys.every((k) => patch[k] === this.state[k])) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** Current position on the book timeline, in seconds. */
  position(): number {
    if (this.track < 0 || this.state.loading || this.state.error) return this.state.position;
    return this.offsets[this.track] + this.audio.currentTime;
  }

  // Opening books

  async open(book: Book, autoplay = false) {
    if (this.state.book?.id === book.id) {
      if (autoplay) this.play();
      return;
    }
    if (this.state.book) {
      this.pause();
      this.flush();
    }
    const progress = library.progressOf(book.id);
    this.offsets = trackOffsets(book);
    this.track = -1;
    this.chapterIndex = -1;
    this.clearSleep();
    this.audio.defaultPlaybackRate = progress.rate;
    this.set({
      book,
      position: clamp(progress.position, 0, book.duration),
      rate: progress.rate,
      playing: autoplay,
      error: null,
    });
    try {
      localStorage.setItem(LAST_BOOK_KEY, book.id);
    } catch {
      // Not critical: only used to reopen the book on the next visit.
    }
    this.updateMetadata();
    const { index, time } = this.locate(this.state.position);
    this.playAfterLoad = autoplay;
    await this.loadTrack(index, time);
  }

  /** Reopens the book that was open during the previous visit, paused. */
  restore() {
    let id: string | null = null;
    try {
      id = localStorage.getItem(LAST_BOOK_KEY);
    } catch {
      return;
    }
    const book = id ? library.book(id) : undefined;
    if (book) void this.open(book);
  }

  close() {
    this.loadId++;
    this.playAfterLoad = false;
    this.clearSleep();
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.track = -1;
    this.set({ book: null, playing: false, position: 0, loading: false, error: null });
    try {
      localStorage.removeItem(LAST_BOOK_KEY);
    } catch {
      // ignore
    }
    this.updateMetadata();
    this.updatePlaybackState();
  }

  private async loadTrack(index: number, time: number): Promise<boolean> {
    const book = this.state.book;
    if (!book) return false;
    const id = ++this.loadId;
    this.set({ loading: true, error: null });
    const blob = await getFile(book.tracks[index].id).catch(() => undefined);
    if (id !== this.loadId) return false;
    if (!blob) return this.loadFailed('Аудиофайл не найден в хранилище браузера');

    const url = URL.createObjectURL(blob);
    // Changing the source drops queued media events, including the echo of our own pause.
    this.ownPause = false;
    this.audio.src = url;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = url;
    this.track = index;
    const ok = await metadataLoaded(this.audio);
    if (id !== this.loadId) return false;
    if (!ok) return this.loadFailed('Браузер не может воспроизвести этот файл');

    this.audio.playbackRate = this.state.rate;
    const duration = this.audio.duration;
    this.audio.currentTime = Number.isFinite(duration) ? Math.min(time, duration) : time;
    this.set({ loading: false });
    this.updatePositionState();
    if (this.playAfterLoad) {
      this.playAfterLoad = false;
      void this.startPlayback();
    }
    return true;
  }

  private loadFailed(error: string): false {
    this.playAfterLoad = false;
    this.set({ loading: false, playing: false, error });
    return false;
  }

  /** Maps a book position to a track and a time within it. */
  private locate(position: number): { index: number; time: number } {
    const tracks = this.state.book!.tracks;
    // The loaded file may be a bit longer than its recorded duration: stay in it when possible.
    if (this.track >= 0 && !this.state.loading) {
      const time = position - this.offsets[this.track];
      const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : tracks[this.track].duration;
      if (time >= 0 && time < duration - 0.05) return { index: this.track, time };
    }
    let index = tracks.length - 1;
    while (index > 0 && position < this.offsets[index]) index--;
    return { index, time: clamp(position - this.offsets[index], 0, tracks[index].duration) };
  }

  // Transport

  play() {
    const book = this.state.book;
    if (!book) return;
    if (this.state.loading) {
      this.playAfterLoad = true;
      this.set({ playing: true });
      return;
    }
    if (this.track < 0 || this.state.error) {
      // The previous load failed: try again.
      const { index, time } = this.locate(this.state.position);
      this.playAfterLoad = true;
      void this.loadTrack(index, time);
      return;
    }
    if (this.position() >= book.duration - 0.5) {
      this.playFrom(0);
      return;
    }
    void this.startPlayback();
  }

  pause() {
    this.playAfterLoad = false;
    if (this.audio.paused) {
      this.sync();
      return;
    }
    this.ownPause = true;
    this.audio.pause();
    this.sync();
    this.afterStop();
  }

  toggle() {
    if (this.state.playing) this.pause();
    else this.play();
  }

  /** Pauses without the rewind and moves to `position` (marking a book finished, starting over). */
  stopAt(position: number) {
    this.playAfterLoad = false;
    if (!this.audio.paused) {
      this.ownPause = true;
      this.audio.pause();
    }
    this.sync();
    this.updatePlaybackState();
    void this.seek(position);
  }

  /** Seeks and starts playing (chapter and bookmark clicks). */
  playFrom(position: number) {
    this.playAfterLoad = true;
    void this.seek(position).then(() => {
      if (!this.playAfterLoad) return; // consumed by a file switch, or cancelled by pause()
      this.playAfterLoad = false;
      void this.startPlayback();
    });
  }

  async seek(target: number) {
    this.dirty = true;
    await this.moveTo(target);
    this.saveSoon();
  }

  /** Moves the playhead without saving the progress. */
  private async moveTo(target: number) {
    const book = this.state.book;
    if (!book) return;
    const position = clamp(target, 0, book.duration);
    const { index, time } = this.locate(position);
    this.set({ position });
    if (this.state.sleep.kind === 'chapter') this.sleepChapterEnd = chapterAt(book, position).end;
    if (index === this.track && !this.state.loading) {
      this.audio.currentTime = time;
    } else {
      if (!this.audio.paused) this.playAfterLoad = true;
      await this.loadTrack(index, time);
    }
    this.updatePositionState();
  }

  skip(seconds: number) {
    void this.seek(this.position() + seconds);
  }

  prevChapter() {
    const book = this.state.book;
    if (!book) return;
    const position = this.position();
    const chapter = chapterAt(book, position);
    // Like a CD player: the first press goes back to the start of the current chapter.
    const restart = position - chapter.start > 3 || chapter.index === 0;
    void this.seek(restart ? chapter.start : book.chapters[chapter.index - 1].start);
  }

  nextChapter() {
    const book = this.state.book;
    if (!book) return;
    const next = book.chapters[chapterIndexAt(book.chapters, this.position()) + 1];
    if (next) void this.seek(next.start);
  }

  setRate(rate: number) {
    const value = Math.round(clamp(rate, 0.5, 3) * 100) / 100;
    this.audio.playbackRate = value;
    this.audio.defaultPlaybackRate = value;
    this.set({ rate: value });
    if (this.state.book) library.saveProgress(this.state.book.id, { rate: value });
    this.updatePositionState();
  }

  /** Minutes, the end of the current chapter, or off. */
  setSleep(option: number | 'chapter' | 'off') {
    this.clearSleep();
    const book = this.state.book;
    if (option === 'off' || !book) return;
    if (option === 'chapter') {
      this.sleepChapterEnd = chapterAt(book, this.position()).end;
      this.set({ sleep: { kind: 'chapter' } });
    } else {
      const ms = option * 60_000;
      this.sleepTimer = window.setTimeout(() => {
        this.clearSleep();
        this.pause();
      }, ms);
      this.set({ sleep: { kind: 'timer', endsAt: Date.now() + ms } });
    }
  }

  private clearSleep() {
    clearTimeout(this.sleepTimer);
    this.sleepChapterEnd = Infinity;
    this.set({ sleep: SLEEP_OFF });
  }

  private async startPlayback() {
    this.set({ error: null });
    try {
      await this.audio.play();
    } catch (error) {
      const name = (error as DOMException).name;
      if (name === 'AbortError') return; // interrupted by a new load or a pause
      // NotAllowedError: autoplay was blocked, the user just has to press play.
      this.set({ playing: false, error: name === 'NotAllowedError' ? null : 'Не удалось начать воспроизведение' });
    }
  }

  /** Rewinds a little after the user (or the system) stops playback, so it is easy to pick up the thread. */
  private afterStop() {
    this.updatePlaybackState();
    const rewind = getSettings().rewindOnPause;
    // seek() moves the position synchronously, so the rewound position is what gets saved.
    if (rewind > 0) void this.seek(this.position() - rewind);
    this.save();
  }

  // Audio element events

  private sync() {
    this.set({ playing: !this.audio.paused || this.playAfterLoad });
  }

  private onPlay = () => {
    this.sync();
    this.channel?.postMessage('play');
    const book = this.state.book;
    if (book) library.saveProgress(book.id, { finished: false, lastPlayedAt: Date.now() });
    this.updatePlaybackState();
    this.updatePositionState();
  };

  private onPause = () => {
    if (this.ownPause) {
      this.ownPause = false;
      return;
    }
    this.sync();
    // Pauses at the end of a file and while switching files are not user pauses.
    if (!this.state.book || this.audio.ended || this.state.loading) return;
    // Paused by the browser or the OS: headphones unplugged, a phone call, a hardware key.
    this.afterStop();
  };

  private onEnded = () => {
    const book = this.state.book;
    if (!book) return;
    const next = this.track + 1;
    if (next < book.tracks.length) {
      const sleepNow = this.state.sleep.kind === 'chapter' && this.offsets[next] >= this.sleepChapterEnd - 0.5;
      if (sleepNow) this.clearSleep();
      this.playAfterLoad = !sleepNow;
      this.sync();
      this.set({ position: this.offsets[next] });
      void this.loadTrack(next, 0).then(() => this.save());
    } else {
      this.playAfterLoad = false;
      this.clearSleep();
      this.set({ position: book.duration, playing: false });
      library.saveProgress(book.id, { position: book.duration, finished: true });
      this.updatePlaybackState();
    }
  };

  private onTimeUpdate = () => {
    const book = this.state.book;
    if (!book || this.state.loading || this.track < 0) return;
    const position = this.position();
    this.set({ position });
    if (!this.audio.paused) this.dirty = true;
    const chapter = chapterIndexAt(book.chapters, position);
    if (chapter !== this.chapterIndex) {
      this.chapterIndex = chapter;
      this.updateMetadata();
      this.updatePositionState();
    }
    if (this.audio.paused) return;
    if (position >= this.sleepChapterEnd - 0.3) {
      this.clearSleep();
      this.pause();
    } else if (Date.now() - this.lastSave >= SAVE_INTERVAL) {
      this.save();
    }
  };

  private onError = () => {
    if (!this.state.book || this.state.loading) return; // load failures are reported by loadTrack
    this.playAfterLoad = false;
    this.set({ playing: false, error: 'Ошибка при воспроизведении файла' });
  };

  /** Another tab saved progress: follow it unless this tab is playing the book. */
  private onExternalProgress = (progress: Progress) => {
    const book = this.state.book;
    if (!book || progress.bookId !== book.id || !this.audio.paused || this.playAfterLoad || this.state.loading) return;
    if (progress.rate !== this.state.rate) {
      this.audio.playbackRate = this.audio.defaultPlaybackRate = progress.rate;
      this.set({ rate: progress.rate });
    }
    if (Math.abs(progress.position - this.position()) > 0.5) void this.moveTo(progress.position);
  };

  private onLibraryChange = () => {
    const current = this.state.book;
    if (!current) return;
    const book = library.book(current.id);
    if (!book) {
      this.close();
    } else if (book !== current) {
      this.set({ book });
      this.updateMetadata();
    }
  };

  // Persistence

  save() {
    const book = this.state.book;
    if (!book) return;
    clearTimeout(this.saveTimer);
    this.dirty = false;
    this.lastSave = Date.now();
    library.saveProgress(book.id, {
      position: this.position(),
      rate: this.state.rate,
      ...(this.state.playing ? { lastPlayedAt: Date.now() } : {}),
    });
  }

  /** Saves only what changed in this tab. */
  private flush() {
    if (this.dirty) this.save();
  }

  private saveSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 500);
  }

  // Media Session: lock screen, notification and hardware media keys

  private setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => this.play()],
      ['pause', () => this.pause()],
      ['stop', () => this.pause()],
      ['seekbackward', () => this.skip(-getSettings().skipBack)],
      ['seekforward', () => this.skip(getSettings().skipForward)],
      ['previoustrack', () => this.prevChapter()],
      ['nexttrack', () => this.nextChapter()],
      [
        'seekto',
        (details) => {
          const book = this.state.book;
          if (book && details.seekTime !== undefined) {
            void this.seek(chapterAt(book, this.position()).start + details.seekTime);
          }
        },
      ],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Action not supported by this browser.
      }
    }
  }

  private updateMetadata() {
    if (!('mediaSession' in navigator)) return;
    const book = this.state.book;
    if (!book) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const cover = library.getState().covers[book.id];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: chapterAt(book, this.position()).title,
      artist: book.author,
      album: book.title,
      artwork: cover ? [{ src: cover }] : [],
    });
  }

  private updatePlaybackState() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = !this.state.book ? 'none' : this.audio.paused ? 'paused' : 'playing';
  }

  /** The lock screen shows progress within the current chapter. */
  private updatePositionState() {
    const book = this.state.book;
    if (!book || !('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const position = this.position();
    const chapter = chapterAt(book, position);
    const duration = chapter.end - chapter.start;
    if (!(duration > 0)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: this.state.rate,
        position: clamp(position - chapter.start, 0, duration),
      });
    } catch {
      // Inconsistent values while switching files; the next update fixes it.
    }
  }
}

export const player = new Player();

export const usePlayer = () => useSyncExternalStore(player.subscribe, player.getState);

/** Subscribes to a slice of the player state; `select` must return a primitive or a stable reference. */
export const usePlayerSelector = <T,>(select: (state: PlayerState) => T) =>
  useSyncExternalStore(player.subscribe, () => select(player.getState()));
