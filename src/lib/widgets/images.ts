export function readWidgetImageSize(value: string): { width: number; height: number } | undefined {
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([a-z0-9+/=\r\n]+)$/i.exec(value);
  let bytes: Uint8Array<ArrayBuffer>;
  let view: DataView<ArrayBuffer>;
  let width = 0;
  let height = 0;
  let offset = 2;
  let marker: number;
  let length: number;
  let bits: number;
  if (!match || value.length > 8192) return undefined;
  try {
    bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
    view = new DataView(bytes.buffer);
    if (match[1].toLowerCase() === 'png' && view.getUint32(0) === 0x89504e47) {
      width = view.getUint32(16);
      height = view.getUint32(20);
    } else if (match[1].toLowerCase() === 'gif' && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) {
      width = view.getUint16(6, true);
      height = view.getUint16(8, true);
    } else if (match[1].toLowerCase() === 'jpeg' && view.getUint16(0) === 0xffd8) {
      while (offset + 8 < bytes.length) {
        if (bytes[offset++] !== 0xff) return undefined;
        while (bytes[offset] === 0xff) offset++;
        marker = bytes[offset++];
        length = view.getUint16(offset);
        if (length < 2) return undefined;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          height = view.getUint16(offset + 3);
          width = view.getUint16(offset + 5);
          break;
        }
        offset += length;
      }
    } else if (match[1].toLowerCase() === 'webp'
      && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) {
      if (view.getUint32(12) === 0x56503858) {
        width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
        height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      } else if (view.getUint32(12) === 0x5650384c && bytes[20] === 0x2f) {
        bits = view.getUint32(21, true);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      } else if (view.getUint32(12) === 0x56503820) {
        width = view.getUint16(26, true) & 0x3fff;
        height = view.getUint16(28, true) & 0x3fff;
      }
    }
  } catch {
    return undefined;
  }
  return width > 0 && width <= 1024 && height > 0 && height <= 1024 ? { width, height } : undefined;
}
