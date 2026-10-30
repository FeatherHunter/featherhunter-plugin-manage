/**
 * Minimal palette-PNG encoder plus PNG/JPEG decoding for the data build.
 *
 * pngjs can only *write* truecolor/grayscale PNGs (colour types 0, 2, 4, 6).
 * The QR crops need palette PNGs (16 colours, bit depth 4) to fit the baseline
 * size budget, so this module writes IHDR/PLTE/IDAT/IEND on top of node:zlib.
 * Decoding stays on pngjs (PNG) and jpeg-js (JPEG), both dev dependencies.
 */
import { deflateSync } from "node:zlib";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

/** Opaque or alpha-carrying RGBA bitmap, 4 bytes per pixel, row-major. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Palette PNG payload: RGB palette + one palette index per pixel. */
export interface PaletteImage {
  palette: Uint8Array;
  indices: Uint8Array;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

export function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

export function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer.subarray(0, 3).equals(JPEG_SIGNATURE);
}

/** Decode a PNG or JPEG buffer into RGBA. Throws on anything else. */
export function decodeImage(buffer: Buffer): RgbaImage {
  if (isPng(buffer)) {
    const png = PNG.sync.read(buffer);
    return { width: png.width, height: png.height, data: Uint8Array.from(png.data) };
  }
  if (isJpeg(buffer)) {
    const raw = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
    return { width: raw.width, height: raw.height, data: Uint8Array.from(raw.data) };
  }
  throw new Error("unsupported image format (expected PNG or JPEG)");
}

/** Encode as an ordinary truecolor (8-bit RGBA) PNG. Used for source cards. */
export function encodeTruecolorPng(image: RgbaImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  return PNG.sync.write(png);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Encode a palette PNG. Bit depth is 4 when the palette has <= 16 colours
 * (two pixels per byte) and 8 otherwise; PNG only allows up to 256 colours.
 */
export function encodePalettePng(
  width: number,
  height: number,
  palette: Uint8Array,
  indices: Uint8Array,
): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`palette png: invalid size ${width}x${height}`);
  }
  if (palette.length % 3 !== 0) throw new Error("palette png: palette length must be a multiple of 3");
  const colors = palette.length / 3;
  if (colors < 1 || colors > 256) throw new Error(`palette png: ${colors} colours (max 256)`);
  if (indices.length !== width * height) {
    throw new Error(`palette png: expected ${width * height} indices, got ${indices.length}`);
  }

  const bitDepth = colors <= 16 ? 4 : 8;
  const rowBytes = Math.ceil((width * bitDepth) / 8);
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const index = indices[y * width + x]!;
      if (bitDepth === 8) {
        raw[rowStart + 1 + x] = index;
      } else {
        const bytePos = rowStart + 1 + (x >> 1);
        if ((x & 1) === 0) raw[bytePos] = (index & 0x0f) << 4;
        else raw[bytePos] = raw[bytePos]! | (index & 0x0f);
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = 3; // colour type: palette
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("PLTE", Buffer.from(palette)),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
