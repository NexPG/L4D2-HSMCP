/**
 * Where each lump descriptor's fields live in this buffer.
 *
 * A BSP v21 file can use either field order: every other Source game writes
 * `{fileofs, filelen, version, fourCC}`, and Left 4 Dead 2 writes
 * `{version, fileofs, filelen, fourCC}`. Tests that mutate a descriptor must write the
 * right field, or they corrupt a different one and assert against the wrong thing.
 *
 * The same detection the reader uses: a 21 header whose bytes at 8 are zero is L4D2's.
 */
export interface LumpFields {
  offset: number;
  length: number;
  version: number;
  fourCC: number;
}

export function lumpFields(buf: Buffer, index: number): LumpFields {
  const base = 8 + index * 16;
  const l4d2 = buf.length >= 12 && buf.readInt32LE(4) === 21 && buf.readInt32LE(8) === 0;
  return l4d2
    ? { version: base, offset: base + 4, length: base + 8, fourCC: base + 12 }
    : { offset: base, length: base + 4, version: base + 8, fourCC: base + 12 };
}
