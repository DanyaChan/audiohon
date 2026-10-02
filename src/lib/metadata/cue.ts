export interface CueTrack {
  title: string;
  performer?: string;
  /** Seconds from the start of the file. */
  start: number;
}

export interface CueFile {
  name: string;
  tracks: CueTrack[];
}

export interface CueSheet {
  title?: string;
  performer?: string;
  files: CueFile[];
}

const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, '$1').trim();

/** mm:ss:ff, where ff are 1/75 s frames. */
function parseTime(s: string): number | undefined {
  const m = /^(\d+):(\d+):(\d+)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 75 : undefined;
}

export function parseCue(text: string): CueSheet {
  const sheet: CueSheet = { files: [] };
  let file: CueFile | undefined;
  let track: (CueTrack & { index0?: number; index1?: number }) | undefined;

  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\S+)\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const [, command, rest] = m;
    switch (command.toUpperCase()) {
      case 'TITLE':
        if (track) track.title = unquote(rest);
        else sheet.title = unquote(rest);
        break;
      case 'PERFORMER':
        if (track) track.performer = unquote(rest);
        else sheet.performer = unquote(rest);
        break;
      case 'FILE': {
        // FILE "name with spaces.mp3" MP3 — the type is the last word.
        const name = rest.startsWith('"') ? rest.slice(1, rest.indexOf('"', 1)) : rest.replace(/\s+\S+$/, '');
        file = { name, tracks: [] };
        sheet.files.push(file);
        track = undefined;
        break;
      }
      case 'TRACK':
        if (file) {
          track = { title: '', start: 0 };
          file.tracks.push(track);
        }
        break;
      case 'INDEX': {
        const [number, time] = rest.split(/\s+/);
        const seconds = parseTime(time ?? '');
        if (!track || seconds === undefined) break;
        if (Number(number) === 1) track.index1 = seconds;
        else if (Number(number) === 0) track.index0 = seconds;
        track.start = track.index1 ?? track.index0 ?? 0;
        break;
      }
    }
  }

  for (const f of sheet.files) {
    f.tracks = f.tracks.map(({ title, performer, start }) => ({ title, performer, start }));
  }
  return sheet;
}
