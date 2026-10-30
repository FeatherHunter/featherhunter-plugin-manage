/**
 * Deterministic image operations for the contact data build: crop, resize,
 * median-cut quantisation, card normalisation and a cheap "is there a code
 * here" contrast gate. Everything runs on the RGBA bitmaps from ./png.
 */
import { encodePalettePng, type PaletteImage, type RgbaImage } from "./png";

export interface CropBox {
  x: number;
  y: number;
  size: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

/** Crop a square region; throws when the box leaves the image. */
export function cropImage(image: RgbaImage, box: CropBox): RgbaImage {
  const { x, y, size } = box;
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    !Number.isInteger(size) ||
    size <= 0 ||
    x < 0 ||
    y < 0 ||
    x + size > image.width ||
    y + size > image.height
  ) {
    throw new Error(`crop box ${x},${y},${size} leaves a ${image.width}x${image.height} image`);
  }
  const data = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    const sourceStart = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(sourceStart, sourceStart + size * 4), row * size * 4);
  }
  return { width: size, height: size, data };
}

function resizeArea(src: RgbaImage, width: number, height: number): RgbaImage {
  const out = new Uint8Array(width * height * 4);
  const scaleX = src.width / width;
  const scaleY = src.height / height;
  for (let dy = 0; dy < height; dy += 1) {
    const y0 = dy * scaleY;
    const y1 = (dy + 1) * scaleY;
    const iy0 = Math.floor(y0);
    const iy1 = Math.min(src.height, Math.ceil(y1));
    for (let dx = 0; dx < width; dx += 1) {
      const x0 = dx * scaleX;
      const x1 = (dx + 1) * scaleX;
      const ix0 = Math.floor(x0);
      const ix1 = Math.min(src.width, Math.ceil(x1));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weightSum = 0;
      for (let sy = iy0; sy < iy1; sy += 1) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        if (wy <= 0) continue;
        for (let sx = ix0; sx < ix1; sx += 1) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          if (wx <= 0) continue;
          const weight = wx * wy;
          const offset = (sy * src.width + sx) * 4;
          r += src.data[offset]! * weight;
          g += src.data[offset + 1]! * weight;
          b += src.data[offset + 2]! * weight;
          a += src.data[offset + 3]! * weight;
          weightSum += weight;
        }
      }
      const offset = (dy * width + dx) * 4;
      out[offset] = Math.round(r / weightSum);
      out[offset + 1] = Math.round(g / weightSum);
      out[offset + 2] = Math.round(b / weightSum);
      out[offset + 3] = Math.round(a / weightSum);
    }
  }
  return { width, height, data: out };
}

function resizeBilinear(src: RgbaImage, width: number, height: number): RgbaImage {
  const out = new Uint8Array(width * height * 4);
  for (let dy = 0; dy < height; dy += 1) {
    const sy = ((dy + 0.5) * src.height) / height - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const fy = Math.min(1, Math.max(0, sy - y0));
    for (let dx = 0; dx < width; dx += 1) {
      const sx = ((dx + 0.5) * src.width) / width - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const fx = Math.min(1, Math.max(0, sx - x0));
      const offset = (dy * width + dx) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const p00 = src.data[(y0 * src.width + x0) * 4 + channel]!;
        const p10 = src.data[(y0 * src.width + x1) * 4 + channel]!;
        const p01 = src.data[(y1 * src.width + x0) * 4 + channel]!;
        const p11 = src.data[(y1 * src.width + x1) * 4 + channel]!;
        const top = p00 + (p10 - p00) * fx;
        const bottom = p01 + (p11 - p01) * fx;
        out[offset + channel] = Math.round(top + (bottom - top) * fy);
      }
    }
  }
  return { width, height, data: out };
}

/** Area-average when shrinking, bilinear when growing. Deterministic. */
export function resizeImage(image: RgbaImage, width: number, height: number): RgbaImage {
  if (width <= 0 || height <= 0) throw new Error(`resize: invalid size ${width}x${height}`);
  if (image.width === width && image.height === height) {
    return { width, height, data: Uint8Array.from(image.data) };
  }
  return width * height < image.width * image.height
    ? resizeArea(image, width, height)
    : resizeBilinear(image, width, height);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2) : sorted[middle]!;
}

/** Median RGB of the left/right card edges (used as the padding colour). */
export function edgeColor(image: RgbaImage): [number, number, number] {
  const channels: [number[], number[], number[]] = [[], [], []];
  const columns = [Math.min(5, image.width - 1), Math.max(0, image.width - 6)];
  const from = Math.floor(image.height * 0.2);
  const to = Math.floor(image.height * 0.8);
  for (const x of columns) {
    for (let y = from; y < to; y += 2) {
      const offset = (y * image.width + x) * 4;
      channels[0].push(image.data[offset]!);
      channels[1].push(image.data[offset + 1]!);
      channels[2].push(image.data[offset + 2]!);
    }
  }
  return [median(channels[0]), median(channels[1]), median(channels[2])];
}

/**
 * Fit an arbitrary screenshot onto the fixed card template: scale to contain,
 * then centre it on a canvas filled with the card's edge colour.
 */
export function normalizeCard(image: RgbaImage, canvas: CanvasSize): RgbaImage {
  const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const scaled = resizeImage(image, width, height);
  const [r, g, b] = edgeColor(image);
  const out = new Uint8Array(canvas.width * canvas.height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = 255;
  }
  const offsetX = Math.floor((canvas.width - width) / 2);
  const offsetY = Math.floor((canvas.height - height) / 2);
  for (let row = 0; row < height; row += 1) {
    const targetStart = ((offsetY + row) * canvas.width + offsetX) * 4;
    out.set(scaled.data.subarray(row * width * 4, (row + 1) * width * 4), targetStart);
  }
  return { width: canvas.width, height: canvas.height, data: out };
}

/** Standard deviation of luminance; a blank crop scores near zero. */
export function luminanceStdDev(image: RgbaImage): number {
  const values = new Float64Array(image.width * image.height);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const offset = i * 4;
    const value = 0.299 * image.data[offset]! + 0.587 * image.data[offset + 1]! + 0.114 * image.data[offset + 2]!;
    values[i] = value;
    sum += value;
  }
  const mean = sum / values.length;
  let variance = 0;
  for (let i = 0; i < values.length; i += 1) variance += (values[i]! - mean) ** 2;
  return Math.sqrt(variance / values.length);
}

interface ColorCount {
  r: number;
  g: number;
  b: number;
  count: number;
}

interface ColorBox {
  colors: ColorCount[];
  count: number;
  ranges: [number, number, number];
}

function makeBox(colors: ColorCount[]): ColorBox {
  let minR = 255;
  let minG = 255;
  let minB = 255;
  let maxR = 0;
  let maxG = 0;
  let maxB = 0;
  let count = 0;
  for (const color of colors) {
    if (color.r < minR) minR = color.r;
    if (color.g < minG) minG = color.g;
    if (color.b < minB) minB = color.b;
    if (color.r > maxR) maxR = color.r;
    if (color.g > maxG) maxG = color.g;
    if (color.b > maxB) maxB = color.b;
    count += color.count;
  }
  return { colors, count, ranges: [maxR - minR, maxG - minG, maxB - minB] };
}

function splitBox(box: ColorBox): [ColorBox, ColorBox] | null {
  if (box.colors.length < 2) return null;
  const ranges = box.ranges;
  const channel = ranges[0] >= ranges[1] && ranges[0] >= ranges[2] ? 0 : ranges[1] >= ranges[2] ? 1 : 2;
  const field = channel === 0 ? "r" : channel === 1 ? "g" : "b";
  const sorted = [...box.colors].sort(
    (a, b) =>
      a[field] - b[field] || a.r - b.r || a.g - b.g || a.b - b.b,
  );
  const target = box.count / 2;
  let accumulated = 0;
  let splitAt = -1;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    accumulated += sorted[i]!.count;
    if (accumulated >= target) {
      splitAt = i + 1;
      break;
    }
  }
  if (splitAt <= 0 || splitAt >= sorted.length) splitAt = Math.floor(sorted.length / 2);
  return [makeBox(sorted.slice(0, splitAt)), makeBox(sorted.slice(splitAt))];
}

/**
 * Deterministic median-cut quantisation. Colours are composited over white so
 * the palette never needs an alpha channel (cards and QR crops are opaque).
 */
export function medianCutPalette(image: RgbaImage, maxColors: number): PaletteImage {
  if (!Number.isInteger(maxColors) || maxColors < 1 || maxColors > 256) {
    throw new Error(`median cut: invalid colour count ${maxColors}`);
  }
  const histogram = new Map<number, ColorCount>();
  const data = image.data;
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3]!;
    const r = alpha === 255 ? data[offset]! : Math.round((data[offset]! * alpha + 255 * (255 - alpha)) / 255);
    const g = alpha === 255 ? data[offset + 1]! : Math.round((data[offset + 1]! * alpha + 255 * (255 - alpha)) / 255);
    const b = alpha === 255 ? data[offset + 2]! : Math.round((data[offset + 2]! * alpha + 255 * (255 - alpha)) / 255);
    const key = (r << 16) | (g << 8) | b;
    const existing = histogram.get(key);
    if (existing) existing.count += 1;
    else histogram.set(key, { r, g, b, count: 1 });
  }
  const colors = [...histogram.values()].sort(
    (a, b) => a.r - b.r || a.g - b.g || a.b - b.b,
  );
  if (colors.length === 0) throw new Error("median cut: image has no pixels");

  let boxes: ColorBox[] = [makeBox(colors)];
  while (boxes.length < maxColors) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i]!;
      if (box.colors.length < 2) continue;
      const score = Math.max(...box.ranges) * Math.sqrt(box.count);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;
    const split = splitBox(boxes[bestIndex]!);
    if (!split) break;
    boxes = [...boxes.slice(0, bestIndex), ...split, ...boxes.slice(bestIndex + 1)];
  }

  const palette = new Uint8Array(boxes.length * 3);
  for (let i = 0; i < boxes.length; i += 1) {
    const box = boxes[i]!;
    let r = 0;
    let g = 0;
    let b = 0;
    let total = 0;
    for (const color of box.colors) {
      r += color.r * color.count;
      g += color.g * color.count;
      b += color.b * color.count;
      total += color.count;
    }
    palette[i * 3] = Math.round(r / total);
    palette[i * 3 + 1] = Math.round(g / total);
    palette[i * 3 + 2] = Math.round(b / total);
  }

  const indices = new Uint8Array(image.width * image.height);
  const cache = new Map<number, number>();
  const paletteColors = boxes.length;
  for (let pixel = 0; pixel < indices.length; pixel += 1) {
    const offset = pixel * 4;
    const alpha = data[offset + 3]!;
    const r = alpha === 255 ? data[offset]! : Math.round((data[offset]! * alpha + 255 * (255 - alpha)) / 255);
    const g = alpha === 255 ? data[offset + 1]! : Math.round((data[offset + 1]! * alpha + 255 * (255 - alpha)) / 255);
    const b = alpha === 255 ? data[offset + 2]! : Math.round((data[offset + 2]! * alpha + 255 * (255 - alpha)) / 255);
    const key = (r << 16) | (g << 8) | b;
    const cached = cache.get(key);
    if (cached !== undefined) {
      indices[pixel] = cached;
      continue;
    }
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < paletteColors; i += 1) {
      const dr = r - palette[i * 3]!;
      const dg = g - palette[i * 3 + 1]!;
      const db = b - palette[i * 3 + 2]!;
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    cache.set(key, bestIndex);
    indices[pixel] = bestIndex;
  }
  return { palette, indices };
}

/** Quantise then encode as a palette PNG in one step. */
export function quantizeToPng(image: RgbaImage, maxColors: number): Buffer {
  const { palette, indices } = medianCutPalette(image, maxColors);
  return encodePalettePng(image.width, image.height, palette, indices);
}
