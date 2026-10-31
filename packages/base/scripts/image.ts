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

/** Module count of a QR finder pattern (7x7 with a 1:1:3:1:1 profile). */
const FINDER_MODULES = 7;
/** Minimum published QR edge length (spec: output >= 320px). */
export const QR_MIN_SIZE = 320;
/** Quiet zone required around a published QR code, in modules (ISO/IEC 18004). */
export const QR_QUIET_ZONE_MODULES = 4;

export interface QrFinderPattern {
  /** Centre of the 3x3 core, in pixels. */
  x: number;
  y: number;
  /** Estimated module (pixel) size. */
  moduleSize: number;
}

export interface QrGeometry {
  /** Axis-aligned bounds of the whole symbol, including the finder patterns. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Average edge length in pixels. */
  size: number;
  moduleSize: number;
  finders: QrFinderPattern[];
}

export interface QrDetection {
  /** Verified finder patterns, strongest first (at most three). */
  finders: QrFinderPattern[];
  geometry: QrGeometry | null;
  /** Human readable reason when geometry is null. */
  reason: string | null;
}

function otsuThreshold(gray: Uint8Array): number {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) histogram[gray[i]!] += 1;
  const total = gray.length;
  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value]!;
  let sumDark = 0;
  let darkCount = 0;
  let best = 0;
  let threshold = 127;
  for (let value = 0; value < 256; value += 1) {
    darkCount += histogram[value]!;
    if (darkCount === 0) continue;
    const lightCount = total - darkCount;
    if (lightCount === 0) break;
    sumDark += value * histogram[value]!;
    const darkMean = sumDark / darkCount;
    const lightMean = (sum - sumDark) / lightCount;
    const between = darkCount * lightCount * (darkMean - lightMean) ** 2;
    if (between > best) {
      best = between;
      threshold = value;
    }
  }
  return threshold;
}

function grayscale(image: RgbaImage): Uint8Array {
  const out = new Uint8Array(image.width * image.height);
  for (let i = 0; i < out.length; i += 1) {
    const offset = i * 4;
    out[i] = Math.round(0.299 * image.data[offset]! + 0.587 * image.data[offset + 1]! + 0.114 * image.data[offset + 2]!);
  }
  return out;
}

/** True when five run lengths match the 1:1:3:1:1 finder profile. */
function finderProfile(runs: readonly number[], tolerance: number): number | null {
  const total = runs.reduce((sum, run) => sum + run, 0);
  if (total < FINDER_MODULES) return null;
  const moduleSize = total / FINDER_MODULES;
  const expected = [1, 1, 3, 1, 1];
  for (let i = 0; i < expected.length; i += 1) {
    if (Math.abs(runs[i]! - expected[i]! * moduleSize) > Math.max(1, moduleSize * tolerance)) return null;
  }
  return moduleSize;
}

/**
 * Locate a QR symbol geometrically: binarise, find the three 1:1:3:1:1 finder
 * patterns (horizontal + vertical profiles), cluster them and derive the
 * bounding box from the module size. No decoding — QQ's gradient dots and
 * WeChat's logo make open-source decoders unreliable (see F2).
 */
export function detectQrGeometry(image: RgbaImage): QrDetection {
  const { width, height } = image;
  const gray = grayscale(image);
  const threshold = otsuThreshold(gray);
  const isDark = (x: number, y: number): boolean => gray[y * width + x]! <= threshold;

  const candidates: QrFinderPattern[] = [];
  for (let y = 0; y < height; y += 1) {
    // Run-length encode the row, then slide a five-run window over it. Shifting
    // one run at a time is important: a finder pattern can start in the middle
    // of an arbitrary five-run window (e.g. when it touches a data module).
    const runs: { dark: boolean; start: number; length: number }[] = [];
    let runStart = 0;
    let runDark = isDark(0, y);
    for (let x = 1; x <= width; x += 1) {
      const nextDark = x < width ? isDark(x, y) : !runDark;
      if (nextDark !== runDark) {
        runs.push({ dark: runDark, start: runStart, length: x - runStart });
        runStart = x;
        runDark = nextDark;
      }
    }
    for (let index = 0; index + 4 < runs.length; index += 1) {
      if (!runs[index]!.dark) continue;
      const lengths = [
        runs[index]!.length,
        runs[index + 1]!.length,
        runs[index + 2]!.length,
        runs[index + 3]!.length,
        runs[index + 4]!.length,
      ];
      const moduleSize = finderProfile(lengths, 0.7);
      if (moduleSize === null) continue;
      candidates.push({
        x: runs[index]!.start + lengths[0]! + lengths[1]! + lengths[2]! / 2,
        y,
        moduleSize,
      });
    }
  }
  const verified: QrFinderPattern[] = [];
  for (const candidate of candidates) {
    const px = Math.round(candidate.x);
    if (px < 1 || px >= width - 1) continue;
    let up = 0;
    let cursor = candidate.y;
    while (cursor >= 0 && isDark(px, cursor)) {
      up += 1;
      cursor -= 1;
    }
    let down = 0;
    cursor = candidate.y + 1;
    while (cursor < height && isDark(px, cursor)) {
      down += 1;
      cursor += 1;
    }
    let top = candidate.y - up;
    let lightUp = 0;
    while (top >= 0 && !isDark(px, top)) {
      lightUp += 1;
      top -= 1;
    }
    let darkUp = 0;
    while (top >= 0 && isDark(px, top)) {
      darkUp += 1;
      top -= 1;
    }
    let bottom = candidate.y + down + 1;
    let lightDown = 0;
    while (bottom < height && !isDark(px, bottom)) {
      lightDown += 1;
      bottom += 1;
    }
    let darkDown = 0;
    while (bottom < height && isDark(px, bottom)) {
      darkDown += 1;
      bottom += 1;
    }
    if (lightUp === 0 || lightDown === 0 || darkUp === 0 || darkDown === 0) continue;
    const verticalRuns = [darkUp, lightUp, up + down, lightDown, darkDown];
    const moduleSize = finderProfile(verticalRuns, 0.8);
    if (moduleSize === null) continue;
    if (Math.abs(moduleSize - candidate.moduleSize) > Math.max(1, candidate.moduleSize * 0.6)) continue;
    verified.push({ x: candidate.x, y: candidate.y, moduleSize: (moduleSize + candidate.moduleSize) / 2 });
  }

  interface Cluster {
    x: number;
    y: number;
    moduleSize: number;
    count: number;
  }
  const clusters: Cluster[] = [];
  for (const point of verified) {
    const near = clusters.find(
      (cluster) =>
        Math.abs(cluster.x - point.x) < cluster.moduleSize * 3 &&
        Math.abs(cluster.y - point.y) < cluster.moduleSize * 3,
    );
    if (near) {
      near.x = (near.x * near.count + point.x) / (near.count + 1);
      near.y = (near.y * near.count + point.y) / (near.count + 1);
      near.moduleSize = (near.moduleSize * near.count + point.moduleSize) / (near.count + 1);
      near.count += 1;
    } else {
      clusters.push({ x: point.x, y: point.y, moduleSize: point.moduleSize, count: 1 });
    }
  }
  clusters.sort((a, b) => b.count - a.count);
  const best = clusters.slice(0, 3).map(({ x, y, moduleSize }) => ({ x, y, moduleSize }));
  if (best.length < 3) {
    return { finders: best, geometry: null, reason: `found ${best.length} of 3 finder patterns` };
  }
  const distance = (a: QrFinderPattern, b: QrFinderPattern): number => Math.hypot(a.x - b.x, a.y - b.y);
  const pairs = [
    { i: 0, j: 1, d: distance(best[0]!, best[1]!) },
    { i: 0, j: 2, d: distance(best[0]!, best[2]!) },
    { i: 1, j: 2, d: distance(best[1]!, best[2]!) },
  ].sort((a, b) => b.d - a.d);
  const diagonal = pairs[0]!;
  const topLeftIndex = [0, 1, 2].find((index) => index !== diagonal.i && index !== diagonal.j)!;
  const topLeft = best[topLeftIndex]!;
  const topRight = best[diagonal.i]!;
  const bottomLeft = best[diagonal.j]!;
  const moduleSize = (topLeft.moduleSize + topRight.moduleSize + bottomLeft.moduleSize) / 3;
  const sideA = distance(topLeft, topRight);
  const sideB = distance(topLeft, bottomLeft);
  const squareness = Math.abs(sideA - sideB) / Math.max(sideA, sideB);
  const dot =
    ((topRight.x - topLeft.x) * (bottomLeft.x - topLeft.x) + (topRight.y - topLeft.y) * (bottomLeft.y - topLeft.y)) /
    (sideA * sideB);
  if (squareness > 0.15 || Math.abs(dot) > 0.25) {
    return { finders: best, geometry: null, reason: "finder patterns do not form a square (the code may be rotated or cropped)" };
  }
  const half = (FINDER_MODULES / 2) * moduleSize;
  const left = Math.min(topLeft.x, topRight.x, bottomLeft.x) - half;
  const top = Math.min(topLeft.y, topRight.y, bottomLeft.y) - half;
  const right = Math.max(topLeft.x, topRight.x, bottomLeft.x) + half;
  const bottom = Math.max(topLeft.y, topRight.y, bottomLeft.y) + half;
  return {
    finders: best,
    geometry: {
      left,
      top,
      right,
      bottom,
      size: (right - left + bottom - top) / 2,
      moduleSize,
      finders: best,
    },
    reason: null,
  };
}

/** Pad an image with a solid colour on every side. */
export function padImage(image: RgbaImage, padding: number, color: readonly [number, number, number] = [255, 255, 255]): RgbaImage {
  if (!Number.isInteger(padding) || padding < 0) throw new Error(`pad: invalid padding ${padding}`);
  if (padding === 0) return { width: image.width, height: image.height, data: Uint8Array.from(image.data) };
  const width = image.width + padding * 2;
  const height = image.height + padding * 2;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = 255;
  }
  for (let row = 0; row < image.height; row += 1) {
    const source = row * image.width * 4;
    const target = ((row + padding) * width + padding) * 4;
    data.set(image.data.subarray(source, source + image.width * 4), target);
  }
  return { width, height, data };
}

export interface ExtractQrOptions {
  /** Edge length of the published image (>= QR_MIN_SIZE). Defaults to QR_MIN_SIZE. */
  outputSize?: number;
  /** Required quiet zone in modules. Defaults to QR_QUIET_ZONE_MODULES. */
  quietZoneModules?: number;
  /** Minimum share of the tight crop the re-detected symbol must cover. */
  coverage?: number;
}

/**
 * Turn a calibrated crop box into a publishable QR image: detect the symbol,
 * cut it out tightly, prove the cut-out re-detects with >= 90% coverage, pad a
 * full quiet zone and resize to a square of at least 320px. Throws with a
 * human readable reason when the crop does not contain a complete code.
 */
export function extractQrCode(image: RgbaImage, box: CropBox, options: ExtractQrOptions = {}): RgbaImage {
  const outputSize = Math.max(options.outputSize ?? QR_MIN_SIZE, QR_MIN_SIZE);
  const quietZoneModules = options.quietZoneModules ?? QR_QUIET_ZONE_MODULES;
  const coverageFloor = options.coverage ?? 0.9;
  const cropPixels = cropImage(image, box);
  const first = detectQrGeometry(cropPixels);
  if (!first.geometry) {
    throw new Error(`crop box ${box.x},${box.y},${box.size} does not contain a complete QR code (${first.reason})`);
  }
  const geometry = first.geometry;
  if (geometry.left < -1 || geometry.top < -1 || geometry.right > box.size + 1 || geometry.bottom > box.size + 1) {
    throw new Error(`the QR code in crop box ${box.x},${box.y},${box.size} is clipped; enlarge the crop box`);
  }
  const side = Math.max(1, Math.round(geometry.size));
  const centreX = (geometry.left + geometry.right) / 2;
  const centreY = (geometry.top + geometry.bottom) / 2;
  const x = Math.min(Math.max(0, Math.round(centreX - side / 2)), Math.max(0, box.size - side));
  const y = Math.min(Math.max(0, Math.round(centreY - side / 2)), Math.max(0, box.size - side));
  const tight = cropImage(cropPixels, { x, y, size: side });
  const second = detectQrGeometry(tight);
  if (!second.geometry) {
    throw new Error(`the QR code could not be re-detected after cropping (${second.reason})`);
  }
  const secondGeometry = second.geometry;
  const coverage = Math.min(1, (secondGeometry.size * secondGeometry.size) / (side * side));
  if (coverage < coverageFloor) {
    throw new Error(`the cropped QR code only covers ${(coverage * 100).toFixed(0)}% of the crop (expected at least ${(coverageFloor * 100).toFixed(0)}%)`);
  }
  const moduleSize = (geometry.moduleSize + secondGeometry.moduleSize) / 2;
  const padding = Math.max(1, Math.ceil(moduleSize * quietZoneModules));
  const padded = padImage(tight, padding);
  const published = resizeImage(padded, outputSize, outputSize);
  const third = detectQrGeometry(published);
  if (!third.geometry) {
    throw new Error(`the published QR image is not readable (${third.reason})`);
  }
  const quietModules = [
    third.geometry.left,
    third.geometry.top,
    outputSize - third.geometry.right,
    outputSize - third.geometry.bottom,
  ].map((value) => value / third.geometry!.moduleSize);
  if (Math.min(...quietModules) < quietZoneModules - 0.5) {
    throw new Error(`the published QR image has a quiet zone of only ${Math.min(...quietModules).toFixed(1)} modules (expected ${quietZoneModules})`);
  }
  return published;
}