export interface RawChapter {
  title: string;
  /** Seconds from the start of the file. */
  start: number;
}

export interface AudioMeta {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  cover?: Blob;
  chapters: RawChapter[];
  /** Seconds, when the container states it. */
  duration?: number;
}
