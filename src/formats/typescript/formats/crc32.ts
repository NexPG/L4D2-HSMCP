/**
 * CRC-32 (IEEE 802.3), the checksum Source formats share.
 *
 * VPK entries, the ZIP payload inside a BSP pakfile and every PNG chunk all use this one
 * polynomial. It lived twice — once in the VPK writer and once in the PNG encoder — which is
 * exactly the kind of copy that stays correct until one of them is "optimised".
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let bit = 0; bit < 8; bit += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = (CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}
