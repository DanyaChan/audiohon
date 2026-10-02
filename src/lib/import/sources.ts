import type { SourceFile } from './grouping';

export function fromFileList(files: FileList | File[]): SourceFile[] {
  return Array.from(files, (file) => ({ file, path: file.webkitRelativePath || file.name }));
}

const isFile = (e: FileSystemEntry): e is FileSystemFileEntry => e.isFile;
const isDirectory = (e: FileSystemEntry): e is FileSystemDirectoryEntry => e.isDirectory;

/** Files and whole folders dropped onto the page. Must be called synchronously in the drop handler. */
export function fromDataTransfer(data: DataTransfer): Promise<SourceFile[]> {
  // The DataTransfer is only readable during the event, so grab the entries right away.
  const entries = Array.from(data.items, (item) => item.webkitGetAsEntry?.()).filter(
    (e): e is FileSystemEntry => !!e,
  );
  if (!entries.length) return Promise.resolve(fromFileList(data.files));
  return (async () => {
    const out: SourceFile[] = [];
    for (const entry of entries) await walk(entry, '', out);
    return out;
  })();
}

async function walk(entry: FileSystemEntry, prefix: string, out: SourceFile[]) {
  const path = prefix + entry.name;
  if (isFile(entry)) {
    out.push({ file: await new Promise<File>((resolve, reject) => entry.file(resolve, reject)), path });
  } else if (isDirectory(entry)) {
    const reader = entry.createReader();
    // readEntries returns the directory in batches until it returns an empty one.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walk(child, `${path}/`, out);
    }
  }
}
