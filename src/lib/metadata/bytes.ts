export type Bytes = Uint8Array<ArrayBuffer>;

export async function readRange(blob: Blob, start: number, length: number): Promise<Bytes> {
  const end = Math.min(blob.size, start + length);
  if (start >= end) return new Uint8Array(0);
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

export const u16 = (b: Bytes, o: number) => (b[o] << 8) | b[o + 1];
export const u24 = (b: Bytes, o: number) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
export const u32 = (b: Bytes, o: number) => b[o] * 0x1000000 + u24(b, o + 1);
export const u64 = (b: Bytes, o: number) => u32(b, o) * 0x100000000 + u32(b, o + 4);

/** ID3 "syncsafe" integer: 4 bytes with 7 significant bits each. */
export const syncsafe = (b: Bytes, o: number) =>
  ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

export const ascii = (b: Bytes, o: number, length: number) =>
  String.fromCharCode(...b.subarray(o, o + length));
