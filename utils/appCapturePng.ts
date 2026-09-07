const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Remove WebKit's canvas EXIF without decoding or changing any other PNG chunk. */
export const stripPngExif = (bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => {
  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) throw new Error('Invalid capture PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [bytes.subarray(0, 8)];
  let length = 8;
  let offset = 8;
  let ended = false;
  while (offset < bytes.length) {
    if (ended || offset + 12 > bytes.length) throw new Error('Truncated capture PNG');
    const end = offset + 12 + view.getUint32(offset);
    if (end > bytes.length) throw new Error('Truncated capture PNG');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === 'IEND') {
      if (end !== bytes.length || end !== offset + 12) throw new Error('Invalid capture PNG end');
      ended = true;
    }
    if (type !== 'eXIf') {
      chunks.push(bytes.subarray(offset, end));
      length += end - offset;
    }
    offset = end;
  }
  if (!ended) throw new Error('Truncated capture PNG');
  if (length === bytes.length) return bytes;
  const result = new Uint8Array(length);
  offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};
