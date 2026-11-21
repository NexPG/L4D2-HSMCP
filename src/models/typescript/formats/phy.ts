/**
 * The compiled `.phy` collision file, enough to audit it.
 *
 * A prop's collision is not the model's visible mesh and not the BSP brush: vbsp copies this
 * file into the map for a solid static prop, and `read_static_props` can only say whether the
 * file exists. This reads its shape: how many solids it has, how many convex pieces each
 * solid is made of, and how many triangles those pieces carry. That is what decides whether
 * a QC needs `$concave`: one convex piece per solid is a single hull, more than one is a
 * concave shape that has to be declared, or studiomdl silently keeps only the first piece.
 *
 * ## Layout
 *
 * `phyheader_t` is `size, id, solidCount, checksum`; `size` is the header length, so the
 * solids start there rather than at a fixed 16. Each solid is a 4-byte size followed by a
 * `VPHY`/`IVPS` collision blob. The `IVPS` fourCC is found by search rather than by assuming
 * the length of the VPHY header, because that header changed between engine branches and a
 * fixed skip is exactly the sort of offset that reads as a plausible zero.
 *
 * A convex mesh header is `vertexDataOffset, pieceTag, flags, triangleCount`. The offset is
 * relative to the mesh header; the shared vertex block it points at is 16 bytes per vertex.
 * Each triangle is 16 bytes: four bytes of surface/pad data and three `(vertex, edge)`
 * pairs. Only counts are decoded: the second header word is called a bone index by some
 * readers, but on stock static props it is 0 for most pieces and a large number for one, so
 * it is not reliable as a bone index and is deliberately not reported as one.
 */
export interface PhySolid {
  index: number;
  /** Convex pieces in this solid. More than one means `$concave` is required. */
  convexPieces: number;
  triangles: number;
  /** Unique vertex indices the pieces reference. */
  vertices: number;
}

export interface PhyReport {
  headerSize: number;
  id: number;
  solidCount: number;
  /** The MDL checksum the file was built from. */
  checksum: number;
  solids: PhySolid[];
  maxConvexPieces: number;
  /** The trailing KeyValues block, usually `prop_data`. */
  collisionText: string | null;
}

export class PhyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhyFormatError";
  }
}

function readCollisionText(bytes: Buffer, offset: number): string | null {
  if (offset < 0 || offset >= bytes.length) return null;
  const tail = bytes.subarray(offset).toString("latin1");
  const start = tail.search(/["{]/);
  if (start < 0) return null;
  const end = tail.indexOf("\0", start);
  const text = (end < 0 ? tail.slice(start) : tail.slice(start, end)).trim();
  return text.length > 0 ? text : null;
}

/**
 * Reads the collision report. A malformed solid stops that solid's parse and keeps the
 * solids already read; it does not throw the file away. A `.phy` whose header is wrong is
 * an error, because every offset after it would be a guess.
 */
export function readPhy(bytes: Buffer): PhyReport {
  if (bytes.length < 16) {
    throw new PhyFormatError(`${bytes.length} bytes is too small for a PHY header`);
  }
  const headerSize = bytes.readInt32LE(0);
  const id = bytes.readInt32LE(4);
  const solidCount = bytes.readInt32LE(8);
  const checksum = bytes.readInt32LE(12);
  if (solidCount < 0 || solidCount > 100_000) {
    throw new PhyFormatError(`PHY solid count ${solidCount} is not sane`);
  }
  let position = Math.max(16, Math.min(headerSize, bytes.length));
  const solids: PhySolid[] = [];
  let maxConvexPieces = 0;

  for (let index = 0; index < solidCount; index += 1) {
    if (position + 4 > bytes.length) break;
    const size = bytes.readInt32LE(position);
    const dataStart = position + 4;
    const dataEnd = Math.min(bytes.length, dataStart + Math.max(0, size));
    const ivps = bytes.indexOf("IVPS", dataStart, "latin1");
    if (ivps < 0 || ivps + 4 > dataEnd) {
      solids.push({ index, convexPieces: 0, triangles: 0, vertices: 0 });
      position = dataEnd;
      continue;
    }

    let at = ivps + 4;
    let verticesStart = -1;
    let convexPieces = 0;
    let triangles = 0;
    const vertexIds = new Set<number>();

    while (at + 16 <= dataEnd) {
      const vertexDataOffset = bytes.readInt32LE(at);
      const candidate = at + vertexDataOffset;
      if (vertexDataOffset <= 0 || candidate <= at || candidate > dataEnd) break;
      if (verticesStart < 0) verticesStart = candidate;
      if (at >= verticesStart) break;

      const triangleCount = bytes.readInt32LE(at + 12) >>> 0;
      const triangleStart = at + 16;
      if (triangleCount > 1_000_000 || triangleStart + triangleCount * 16 > verticesStart) {
        break;
      }
      for (let triangle = 0; triangle < triangleCount; triangle += 1) {
        const record = triangleStart + triangle * 16;
        for (let corner = 0; corner < 3; corner += 1) {
          vertexIds.add(bytes.readUInt16LE(record + 4 + corner * 4));
        }
      }
      triangles += triangleCount;
      convexPieces += 1;
      at = triangleStart + triangleCount * 16;
    }

    maxConvexPieces = Math.max(maxConvexPieces, convexPieces);
    solids.push({
      index,
      convexPieces,
      triangles,
      vertices: vertexIds.size,
    });
    position = dataEnd;
  }

  return {
    headerSize,
    id,
    solidCount,
    checksum,
    solids,
    maxConvexPieces,
    collisionText: readCollisionText(bytes, position),
  };
}
